import http from "node:http";

import express, { type Request, type Response, type NextFunction } from "express";
import "express-async-errors";
import cors from "cors";
import bodyParser from "body-parser";
import type { RowDataPacket } from "mysql2/promise";
import ipc from "node-ipc";

import { ENTITIES, ENTITIES_RAW, FIELDS, FIELDS_RAW, VALUES } from "common/dist/structures.js";
import { assert } from "common/dist/utils.js";
import type { NewOrder } from "common/dist/ipc.js";

import { config } from "./config.js";
import { spruton, storage, tinkoff } from "./controllers.js";
import { DBSession } from "./db.js";
import { uselessFront } from "./utils.js";
import { ORDER_PLACEHOLDER, valuesTranslation } from "./structures.js";

const app = express();
app.use(
  (err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    console.error(err.stack);
    res.status(500).send("Internal Server Error");
    //next(err);
  }
);
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

interface RequestContext {
  isTg: boolean;
  email?: string;
  password?: string;
  client?: RowDataPacket;
}

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext
    }
  }
}

interface IErrorResponse {error: true, reason?: string};
type ErrorResponse = IErrorResponse | undefined;

app.use(
  async (req: Request, res: Response, next: NextFunction) => {
    req.ctx = {
      isTg: true
    };

    // TODO: require "tg" in auth header
    if (!req.headers["authorization"]) {
      next();
      return;
    }

    // FIXME: CONTAINS PASSWORD? WHY?
    const [email, password] = req.headers["authorization"].split("_-_");
    for await (const session of DBSession.ctx()) {
      let client = await session.fetchAuthClient(email, password);
      if (client != null) {
        req.ctx = {
          isTg: false,
          email: email,
          password: password,
          client: client
        };
        next();
      } else {
        return res.json({error: true} as IErrorResponse);
      }
    }
  }
);

async function productImage(req: Request, res: Response) {
  const { id, file } = req.params;
  spruton.fileExportDownload(ENTITIES_RAW.products, Number(id), FIELDS_RAW.products.photo, file, res);
}
app.get("/api/product_image/:id/:file", productImage);
app.get("/api/image/:id/:file", productImage);

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
  "/api/products",
  async (req: Request, res: Response) => {
    return res.json({data: await storage.getProductsByCategoryView()});
  }
);

app.get(
  "/api/user",
  async (req: Request, res: Response) => {
    let client, ordersView;
    for await (const session of DBSession.ctx()) {
      if (req.ctx.isTg) {
        const tgID = req.query.userId;
        client = await session.fetchClient(Number(tgID));
      } else {
        client = req.ctx.client;
      }
      assert(client != null);

      let orders = await session.fetchClientOrders(client.id);

      ordersView = [];
      for (const order of orders) {
        const orderItems = await session.fetchOrderItemsView(order.id);
        orderItems.forEach(uselessFront.product);
        let orderTotalPrice = orderItems.reduce(
          (sum, item) => sum + (
            Number(item.quantity)
            * Number(item.price)
            * Number(item.recomendedMinimalSize)
          ),
          0
        )

        ordersView.push({
          orderId: order.id,
          orderDate: order.date_added,
          products: orderItems,
          total: orderTotalPrice
        });
      }
    }

    if (ordersView && ordersView[0]) {
      res.json({
        data: {
          name: client[FIELDS.clients.fullName],
          phone: client[FIELDS.clients.ruPhoneNumber],
          address: client[FIELDS.clients.address],
          company: client[FIELDS.clients.companyName],
          inn: client[FIELDS.clients.inn],
          orders: ordersView
        },
      });
    } else {
      // IDK why, really
      res.json({
        data: {
          name: "",
          phone: "",
          address: "",
          company: "",
          inn: "",
          orders: [],
        },
      });
    }
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

    let client;
    for await (const session of DBSession.ctx()) {
      if (req.ctx.isTg) {
        client = await session.fetchClient(req.body.userId);
      } else {
        client = req.ctx.client;
      }
      assert(client != null);

      let personalDiscount: number;
      {
        let personalDiscountSrc = client[FIELDS.clients.personalDiscount];
        if (!personalDiscountSrc) {
          personalDiscount = 0;
        } else {
          personalDiscount = Number(personalDiscountSrc);
        }
      }
      var {orderID, items} = await session.createOrder(
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
            quantity = Math.ceil(quantity * inBox);
            return [id, {quantity: quantity}];
          }
        ))
      );
      await spruton.touch(ENTITIES_RAW.orders, orderID);

      await session.updateClientData(
        client.id,
        name,
        phone,
        address,
        companyName,
        inn
      );
    }

  if (req.ctx.isTg) {
    let data: NewOrder = {
      orderID: orderID,
      client: {
        tgID: client[FIELDS.clients.tgID],
        fullName: name,
        phoneNumber: phone,
        address: address,
        comment: comment,
        companyName: companyName,
        inn: inn
      },
      src: req.body,
      items: items
    }
    ipc.of.bot.emit("newOrder", data);
  }

  return res.status(200).json({status: "ok", orderID: orderID});
});

interface PaymentInitResponse {status: "ok", amount: number, url: string};
app.post(
  "/api/pay/init",
  async (req: Request, res: Response) => {
    let {
      orderID
    } = req.body;
    assert(typeof orderID !== "undefined");

    const TAX_TRANSLATION = {
      [VALUES.global.tax.none]: "none",
      [VALUES.global.tax.perc10]: "van10",
      [VALUES.global.tax.perc20]: "van20"
    } as const;

    for await (const session of DBSession.ctx()) {
      const order = await session.fetchOrder(orderID);
      const items = await session.fetchOrderItems(orderID);

      const data = await tinkoff.initPayment(
        {
          Amount: order[FIELDS.orders.amount] * 100,
          OrderId: orderID,
          DATA: {
            Email: order[FIELDS.orders.email],
            Phone: order[FIELDS.orders.phoneNumber],
            DefaultCard: "none"  // TODO: maybe save card
          },
          Receipt: {
            Email: order[FIELDS.orders.email],
            Phone: order[FIELDS.orders.phoneNumber],
            Taxation: "osn",
            Items: items.map(
              (item) => {
                return {
                  Name: item[FIELDS.orderItems.article],
                  Price: item[FIELDS.orderItems.price] * 100,
                  Quantity: item[FIELDS.orderItems.quantity],
                  Amount: item[FIELDS.orderItems.amount] * 100,
                  Tax: TAX_TRANSLATION[item[FIELDS.orderItems.tax]]
                };
              }
            )
          }
        }
      );
      assert(typeof data !== "undefined");
      if(!data.Success) {
        return res.status(500).json(
          {
            "error": true,
            "reason": `payment system failed with code ${data.ErrorCode}`
          } as IErrorResponse
        );
      }

      return res.json(
        {
          status: "ok",
          amount: data.Amount,
          url: data.PaymentURL
        } as PaymentInitResponse
      )
    }
  }
)

const server = http.createServer(app);
{
  const port = config.get("web.port");
  server.listen(
    port,
    () => { console.log(`Server is running on port ${port}`); }
  );
}
