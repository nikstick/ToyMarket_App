import http from "node:http";
import { createHmac, createHash, randomUUID } from "node:crypto";

import express, { type Request, type Response, type NextFunction } from "express";
import "express-async-errors";
import cors from "cors";
import bodyParser from "body-parser";
import type { RowDataPacket } from "mysql2/promise";
import ipc from "node-ipc";
import { Netmask } from "netmask";

import { ENTITIES, ENTITIES_RAW, FIELDS, FIELDS_RAW, VALUES } from "common/dist/structures.js";
import { assert, Elevate, makeASCIISafe } from "common/dist/utils.js";
import type { NewOrder } from "common/dist/ipc.js";
import { config } from "common/dist/config.js";

import { spruton, storage, tinkoff } from "./controllers.js";
import { DBSession } from "./db.js";
import { uselessFront } from "./utils.js";
import { ORDER_PLACEHOLDER, valuesTranslation } from "./structures.js";

interface TgUserObject {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
}

type RequestContext = {
  client: RowDataPacket;
} & (
  {
    isTg: true;
    isMiniApp: boolean;
    tgUser: TgUserObject;
  } | {
    isTg: false;
    isMiniApp: false;
    email: string;
    password: string;
  }
);

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}

interface IErrorResponse {error: true, reason?: string};
type ErrorResponse = IErrorResponse | undefined;

const app = express();
app.use(
  (err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof TBankBasicValidationError) {
      console.log(`Tinkoff payment ${err.method} error: ${err.data}`);
      res.status(500).json(
        {
          "error": true,
          "reason": `payment system failed with code ${err.errorCode}`
        } as IErrorResponse
      );
    } else {
      console.error(err);
      console.error(err.stack);
      res.status(500).send("Internal Server Error");
    }
    throw err;
  }
);
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

class BadAuth extends Error {};

function checkAuth(secret: Buffer | string, data: {hash: string, [key: string]: any}): boolean {
  const { hash, ...filtered } = data;
  let encodedData = (
    Object.entries(filtered)
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk))
    .map(([k, v]) => `${k}=${(typeof v === "string" || v instanceof String) ? v : JSON.stringify(v)}`)
    .join("\n")
  );
  return (createHmac("sha256", secret).update(encodedData).digest("hex") == hash);
}

function validateTgUserObject(obj: Partial<TgUserObject>): TgUserObject {
  let names: string[] = ["last_name", "username", "photo_url"] as (keyof TgUserObject)[];
  for (let name of names) {
    if (typeof obj[name] === "undefined") {
      obj[name] = null;
    }
  }
  return obj as TgUserObject;
}

app.use(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      var ctx: RequestContext;

      assert(req.method != "GET", Elevate);
      assert(!req.path.startsWith("/hook"), Elevate);
      const auth = req.headers["authorization"];
      assert(typeof auth !== "undefined", BadAuth);

      if (["MiniApp", "WebApp"].includes(auth)) {
        assert(typeof req.body !== "undefined", BadAuth);
        assert(typeof req.body.tgUserData !== "undefined", BadAuth);
        const tgData = req.body.tgUserData;

        let user: TgUserObject;
        let isMiniApp: boolean = false;
        switch (auth) {
          case "MiniApp": {
            assert(
              checkAuth(
                createHmac("sha256", "WebAppData").update(config.get("bot.token")).digest(),
                tgData
              ), BadAuth
            );
            assert(typeof tgData.user !== "undefined", BadAuth);
            user = tgData.user;
            isMiniApp = true;
            break;
          }
          case "WebApp": {
            assert(
              checkAuth(
                createHash("sha256").update(config.get("bot.token")).digest(),
                tgData
              ), BadAuth
            );
            user = tgData;
            break;
          }
        }
        validateTgUserObject(user);

        for await (const session of DBSession.ctx()) {
          let client = await session.fetchClient(user.id);
          if (client == null) {
            if (auth == "WebApp") {
              let clientID = await session.createClient(
                {
                  fullName: `${user.first_name} ${user.last_name} (@${user.username})`,
                  tgNick: user.username,
                  tgID: user.id,
                  ruPhoneNumber: "",
                  status: VALUES.clients.status.active,
                  email: "",
                  address: "",
                  companyName: "",
                  password: randomUUID(),
                  inn: "",
                  personalDiscount: 0
                }
              );
              await spruton.touch(ENTITIES_RAW.clients, clientID);
              client = await session.fetchClient(user.id);
            }
          }
          assert(client != null, BadAuth);
          ctx = {isTg: true, isMiniApp: isMiniApp, tgUser: user, client: client};
        }
      } else if (auth.includes("_-_")) {
        // FIXME: CONTAINS PASSWORD? WHY?
        const [email, password] = auth.split("_-_");
        for await (const session of DBSession.ctx()) {
          let client = await session.fetchAuthClient(email, password);
          assert(client != null, BadAuth);
          ctx = {
            isTg: false,
            isMiniApp: false,
            email: email,
            password: password,
            client: client
          };
        }
      } else {
        throw new BadAuth();
      }
    } catch(exc) {
      if (exc instanceof Elevate) {
        await next();
        return;
      } else if (exc instanceof BadAuth) {
        return res.status(401).send("Auth error");
      } else {
        console.error(exc);
        console.error(exc.message);
        return res.status(401).send("Auth error");
      }
    }
    req.ctx = ctx;
    await next();
  }
);

app.post(
  "/api/auth/verify",
  async (req: Request, res: Response) => {
    return res.json({verified: true, isTg: req.ctx.isTg, isMiniApp: req.ctx.isMiniApp});
  }
)

async function productImage(req: Request, res: Response) {
  const { id, file } = req.params;
  spruton.fileExportDownload(ENTITIES_RAW.products, Number(id), FIELDS_RAW.products.photo, file, res);
}
app.get("/api/product_image/:id/:file", productImage);
app.get("/api/image/:id/:file", productImage);

app.get(
  "/api/product_other_image/:id/:file",
  async (req: Request, res: Response) => {
    const { id, file } = req.params;
    spruton.fileExportDownload(ENTITIES_RAW.products, Number(id), FIELDS_RAW.products.otherPhotos, file, res);
  }
)

app.get(
  "/api/news_image/:id/:file",
  async (req: Request, res: Response) => {
    const { id, file } = req.params;
    spruton.downloadAttachment(ENTITIES_RAW.news, Number(id), file, res, true);
  }
);
app.get(
  "/api/image2/:file",
  async (req: Request, res: Response) => {
    const { file } = req.params;
    spruton.downloadAttachment(ENTITIES_RAW.news, 1, file, res, true);
  }
);

app.get(
  "/api/trademark_image/:id/:file",
  async (req: Request, res: Response) => {
    const { id, file } = req.params;
    spruton.fileExportDownload(ENTITIES_RAW.tradeMarks, Number(id), FIELDS_RAW.tradeMarks.logo, file, res);
  }
);

app.get(
  "/api/categories",
  async (req: Request, res: Response) => {
    for await (const session of DBSession.ctx()) {
      let data = await session.fetchCategoriesView();
      return res.json({"data": data});
    }
  }
);

app.get(
  "/api/products",
  async (req: Request, res: Response) => {
    return res.json({data: await storage.getProductsByCategoryView()});
  }
);

app.get(
  "/api/product",
  async (req: Request, res: Response) => {
    let model = (req.query.model || null);
    let productID = (req.query.id || null);
    assert((model == null) != (productID == null));
    let data: object[];
    for await (const session of DBSession.ctx()) {
      if (model != null) {
        assert(typeof model == "string");
        data = await session.fetchProductsViewByModel(model as string);
      } else {
        data = await session.fetchProductsView([Number(productID)]);
      }
    }
    data.forEach((product) => uselessFront.product(product))
    return res.json({data: data});
  }
);

app.post(
  "/api/user/get",
  async (req: Request, res: Response) => {
    let client = req.ctx.client;
    for await (const session of DBSession.ctx()) {
      let orders = await session.fetchClientOrders(client.id);

      var ordersView = [];
      for (const order of orders) {
        const orderItems = await session.fetchOrderItemsView(order.id);
        orderItems.forEach(uselessFront.product);
        let orderTotalPrice = orderItems.reduce(
          (sum, item) => sum + Number(item.amount),
          0
        )

        ordersView.push({
          orderId: order.id,
          orderDate: order.date_added,
          products: orderItems,
          total: orderTotalPrice,
          discount: order.personalDiscount
        });
      }
    }

    res.json({
      data: {
        name: client[FIELDS.clients.fullName],
        phone: client[FIELDS.clients.ruPhoneNumber],
        address: client[FIELDS.clients.address],
        company: client[FIELDS.clients.companyName],
        inn: client[FIELDS.clients.inn],
        orders: ordersView,
        personalDiscount: client[FIELDS.clients.personalDiscount]
      },
    });
  }
);

app.post(
  "/api/order",
  async (req: Request, res: Response) => {
    // Order details
    let {
      name,
      phone,
      address,
      comment,
      companyName,
      inn,
      delivery,
      payBy,
      products,
    } = req.body;
    if (typeof comment == "undefined") {
      comment = "";
    }
    if (typeof address == "undefined") {
      address = "";
    }
    if (!name || !phone) {
      return res.status(400).json({error: "Bad Request"});
    }

    let client = req.ctx.client;
    for await (const session of DBSession.ctx()) {
      var personalDiscount: number;
      {
        let personalDiscountSrc = client[FIELDS.clients.personalDiscount];
        if (personalDiscountSrc == null || !personalDiscountSrc) {
          personalDiscount = 0;
        } else {
          personalDiscount = Number(personalDiscountSrc);
        }
      }
      var orderCreationResult = await session.createOrder(
        ORDER_PLACEHOLDER,
        client.id,
        phone,
        client[FIELDS.clients.email],
        address,
        companyName,
        inn,
        personalDiscount,
        comment,
        valuesTranslation.paymentMethod[payBy.toLowerCase()],
        valuesTranslation.deliveryMethod[delivery.toLowerCase()],
        Object.fromEntries(products.map(
          (product) => {
            // FIXME: funny and woozy
            let { id, quantity, inBox } = product;
            quantity = Math.ceil(Number(quantity) * inBox);
            return [id, {quantity: quantity}];
          }
        ))
      );
      await Promise.all(
        orderCreationResult.itemIDs.map(
          async (i) => await spruton.touch(ENTITIES_RAW.orderItems, i)
        )
      );
      await spruton.touch(ENTITIES_RAW.orders, orderCreationResult.orderID);

      await session.updateClientData(
        client.id,
        name,
        phone,
        address,
        companyName,
        inn
      );

      var orderMetaData = await session.fetchOrder(orderCreationResult.orderID);
    }

  if (req.ctx.isTg) {
    setTimeout(
      async () => {
        try {
          var orderMetaExtra = await spruton.fetchOrder(orderCreationResult.orderID);
        } catch (err) {
          console.error(err);
          console.error(err.stack);
          return;
        }
        let data: NewOrder = {
          orderID: orderCreationResult.orderID,
          client: {
            tgID: client[FIELDS.clients.tgID],
            fullName: name,
            phoneNumber: phone,
            address: address,
            comment: comment,
            companyName: companyName,
            inn: inn,
            personalDiscount: personalDiscount
          },
          src: req.body,
          items: orderCreationResult.products,
          orderMeta: orderMetaData,
          orderMetaExtra: orderMetaExtra
        }
        ipc.of.bot.emit("newOrder", data);
      },
      2000
    );
  }

  return res.status(200).json({status: "ok", orderID: orderCreationResult.orderID});
});

class TBankBasicValidationError extends Error {
  method: string;
  errorCode: string;
  data: object;

  constructor(method: string, errorCode: string, data: object) {
    super(`${method}: ${errorCode}`);
    this.method = method;
    this.errorCode = errorCode;
    this.data = data;
  }
}

interface TBankBasicObj {
  Success: boolean;
  ErrorCode?: string;
}
type TBankBasic = TBankBasicObj | undefined;

function tbankBasicValidator(method: string, result: TBankBasic): void {
  assert(typeof result !== "undefined");
  if(!result.Success) {
    throw new TBankBasicValidationError(method, result.ErrorCode, result);
  }
}

interface PaymentInitResponse {error: boolean, amount: number, url: string, paymentID: number};
app.post(
  "/api/payment/tbank/init",
  async (req: Request, res: Response) => {
    let { orderID } = req.body;
    assert(typeof orderID !== "undefined");

    const TAX_TRANSLATION = {
      [VALUES.global.tax.none]: "none",
      [VALUES.global.tax.perc10]: "van10",
      [VALUES.global.tax.perc20]: "van20"
    } as const;

    for await (const session of DBSession.ctx()) {
      const order = await session.fetchOrder(orderID);
      const items = await session.fetchOrderItems(orderID);

      const receiptItems = items.map(
        (item) => {
          return {
            Name: item[FIELDS.orderItems.article],
            Price: Number(item[FIELDS.orderItems.discountedPrice]) * 100,
            Quantity: Number(item[FIELDS.orderItems.quantity]),
            Amount: Number(item[FIELDS.orderItems.discountedPrice]) * Number(item[FIELDS.orderItems.quantity]) * 100,
            Tax: TAX_TRANSLATION[item[FIELDS.orderItems.tax]]
          };
        }
      );
      const SUCCESS_ROUTE = "/hook/payment/success";
      const FAIL_ROUTE = "/hook/payment/fail";
      const result = await tinkoff.initPayment(
        {
          Amount: receiptItems.reduce((x, item) => x + item.Amount, 0),
          OrderId: orderID,
          DATA: {
            Email: order[FIELDS.orders.email],
            Phone: order[FIELDS.orders.phoneNumber],
            //DefaultCard: "none"  // TODO: maybe save card
          },
          Receipt: {
            Email: order[FIELDS.orders.email],
            Phone: order[FIELDS.orders.phoneNumber],
            Taxation: "osn",
            Items: receiptItems
          },
          NotificationURL: config.get("web.apiURL") + TBANK_NOTIFICATION_ROUTE,
          SuccessURL: (req.ctx.isMiniApp ? config.get("bot.webAppURL") + SUCCESS_ROUTE : undefined),
          FailURL: (req.ctx.isMiniApp ? config.get("bot.webAppURL") + FAIL_ROUTE : undefined)
        }
      );
      tbankBasicValidator("init", result);
      // TODO: store paymentID by orderID maybe?

      return res.json(
        {
          error: false,
          amount: result.Amount,
          url: result.PaymentURL,
          paymentID: result.PaymentId
        } as PaymentInitResponse
      )
    }
  }
);

app.post(
  "/api/payment/tbank/cancel",
  async (req: Request, res: Response) => {
    const { paymentID } = req.body;
    const result = await tinkoff.cancelPayment({PaymentId: paymentID});
    assert(typeof result !== "undefined");
    tbankBasicValidator("cancel", result);
    return res.status(200).json({"error": false, orderID: result.OrderId});
  }
)

const TBANK_NETMASKS = [
  "91.194.226.0/23",
  "91.218.132.0/24",
  "91.218.133.0/24",
  "91.218.134.0/24",
  "91.218.135.0/24",
  "212.233.80.0/24",
  "212.233.81.0/24",
  "212.233.82.0/24",
  "212.233.83.0/24",
// "91.194.226.181"  // TEST SERVER
].map((mask) => new Netmask(mask));
function tbankNetmaskCheck(ipaddr: string): boolean {
  return TBANK_NETMASKS.some((mask) => mask.contains(ipaddr));
}

const TBANK_NOTIFICATION_ROUTE = "/hook/payment/tbank/update";
type TBankPaymentStatus = (
  "AUTHORIZED"
  | "CONFIRMED"
  | "PARTIAL_REVERSED"
  | "REVERSED"
  | "PARTIAL_REFUNDED"
  | "REFUNDED"
  | "REJECTED"
  | "DEADLINE_EXPIRED"
);
interface TBankNotificationPayment {
  TerminalKey: string;
  Amount: number;
  OrderId: number;
  Success: boolean;
  Status: TBankPaymentStatus;
  PaymentId: number;
  CardId: number;
};
app.post(
  TBANK_NOTIFICATION_ROUTE,
  async (req: Request, res: Response) => {
    const data: TBankNotificationPayment = req.body;
    assert(typeof data !== "undefined");
    assert(data.TerminalKey == config.get("tinkoff.terminalKey"));
    assert(tbankNetmaskCheck(req.headers["X-Forwarded-For"] as string));
    // FIXME: check crypto

    console.log(`TBank payment ${data.PaymentId}<${data.OrderId}> ${data.Status} (Success: ${data.Success})`);

    for await (const session of DBSession.ctx()) {
      let status = null;
      switch (data.Status) {
        case "CONFIRMED": {
          if (data.Success) { status = VALUES.orders.status.paid; }
          break;
        }
        case "REFUNDED":
        case "PARTIAL_REFUNDED":
        case "REJECTED":
        case "REVERSED":
        case "PARTIAL_REVERSED":
        case "DEADLINE_EXPIRED": {
          status = VALUES.orders.status.cancelled;
          break;
        }
      }
      if (status != null) {
        await session.changeOrderStatus(data.OrderId, status);
        ipc.of.bot.emit("newOrderStatus", data);
      }
    }
    return res.status(200).send("OK");
  }
);

const server = http.createServer(app);
{
  const port = config.get("web.port");
  server.listen(
    port,
    () => { console.log(`Server is running on port ${port}`); }
  );
}
