import http from "node:http";

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import type { RowDataPacket } from "mysql2/promise";

import { ENTITIES, ENTITIES_RAW, FIELDS, FIELDS_RAW } from "common/structures";

import { config } from "./config";
import { spruton, storage } from "./controllers";
import { DBSession } from "./db";
import { assert } from "common/utils";
import { uselessFront } from "./utils";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(
  (err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    console.error(err.stack);
    res.status(500).send("Internal Server Error");
  }
);

interface RequestContext {
  is_tg: boolean;
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

app.use(
  async (req: Request, res: Response, next: NextFunction) => {
    req.ctx = {
      is_tg: true
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
          is_tg: false,
          email: email,
          password: password,
          client: client
        };
        next();
      } else {
        return res.json({error: true});
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
    res.json({data: await storage.getProductsByCategoryView()});
  }
);

app.get(
  "/api/user",
  async (req: Request, res: Response) => {
    let client, ordersView;
    for await (const session of DBSession.ctx()) {
      if (req.ctx.is_tg) {
        const { tgID } = req.query;
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
          company: client[FIELDS.clients.company],
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

const server = http.createServer(app);
{
  const port = config.get("web.port");
  server.listen(
    port,
    () => { console.log(`Server is running on port ${port}`); }
  );
}
