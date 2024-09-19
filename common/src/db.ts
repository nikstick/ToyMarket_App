import {
  type PoolOptions,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
  createPool
} from "mysql2/promise";
import type { Config } from "convict";
import { Decimal } from "decimal.js";

import { ENTITIES_RAW, FIELDS_RAW, VALUES, ENTITIES, FIELDS } from "./structures.js";
import { aliasedAs, assert, AssertionError } from "./utils.js";

interface DBConfigSchema {
  db: {
    host: string
    database: string
    user: string
    password: string,
    extras: Partial<PoolOptions>
  }
}

export class PoolManager<ConfigSchemaT extends DBConfigSchema> {
  private static instance: PoolManager<DBConfigSchema> = null;

  public pool: Pool;

  constructor(
    config: Config<ConfigSchemaT>,
    init: (pool: PoolManager<ConfigSchemaT>) => Promise<any>
  ) {
    let cfg = config as unknown as Config<DBConfigSchema>;
    let {extras, ...extractedCfg} = {  // @ts-ignore FIXME
      ...cfg.get("db.extras"),
      ...cfg.get("db")
    }
    this.pool = createPool(extractedCfg);

    this.init().then();
    init(this).then();
  }

  public static get<T extends DBConfigSchema>(
    ...args: Partial<ConstructorParameters<typeof PoolManager<T>>>
  ): PoolManager<T> {
    if (PoolManager.instance == null) {
      assert(args.length > 0);
      PoolManager.instance = new PoolManager(...args);
    }
    return PoolManager.instance;
  }

  protected async init() {}
}

type DBSessionNew<T> = { new (conn: PoolConnection): T }
export class DBSession {
  public conn: PoolConnection;

  constructor(conn: PoolConnection) {
    this.conn = conn;
  }

  // works like ctx manager with for..of
  public static async *ctx<T>(this: DBSessionNew<T>): AsyncGenerator<T, void, void> {
    try {
      var conn = await PoolManager.get().pool.getConnection();
      yield new this(conn);
    } finally {
      if (typeof conn !== "undefined") {
        conn.release();
      }
    }
  }

  public async fetchClient(clientTgID: number): Promise<RowDataPacket | null> {
    const [rows] = await this.conn.execute(
      `SELECT * FROM ${ENTITIES.clients} WHERE ${FIELDS.clients.tgID} = ?`,
      [clientTgID]
    ) as RowDataPacket[][];
    switch (rows.length) {
      case 0:
        return null;
      case 1:
        return rows[0];
      default:
        throw new AssertionError("multiple clients found");
    }
  }

  // works like ctx manager with for..of
  public async *popNews(): AsyncGenerator<RowDataPacket[], void, void> {
    // FIXME: missing field from `AND ${FIELDS.news.publishDate} <= NOW()`
    const [news] = await this.conn.execute(`
      SELECT * FROM ${ENTITIES.news}
      WHERE id NOT IN (SELECT id FROM tg_bot_published_news)
    `) as RowDataPacket[][];
    yield news;

    if (!news.length) { return; }
    await this.conn.query(
      `INSERT INTO tg_bot_published_news VALUES ?`,
      [news.map(x => [x.id])]
    );
  }

  public async fetchBroadcastableClients(): Promise<RowDataPacket[]> {
    const [users] = await this.conn.execute(`
      SELECT * FROM ${ENTITIES.clients}
      WHERE ${FIELDS.clients.tgID} != ""
    `) as RowDataPacket[][];
    return users;
  }

  public async fetchProductsView(): Promise<RowDataPacket[]> {
    const [products] = await this.conn.execute(`
      SELECT
        product.id AS id,
        category.id AS categoryID,
        category.${aliasedAs(FIELDS.productCategories.name, "categoryName")},
        product.${aliasedAs(FIELDS.products.photo)},
        product.${aliasedAs(FIELDS.products.article)},
        product.${aliasedAs(FIELDS.products.finalPriceServiced, "price")},
        product.${aliasedAs(FIELDS.products.recomendedMinimalSize)},
        product.${aliasedAs(FIELDS.products.boxSize)},
        product.${aliasedAs(FIELDS.products.packageSize)},
        product.${aliasedAs(FIELDS.products.inStock)},
        product.${aliasedAs(FIELDS.products.isNew)},
        product.${aliasedAs(FIELDS.products.description)},
        product.${aliasedAs(FIELDS.products.review)},
        product.${aliasedAs(FIELDS.products.keywords)},
        product.${aliasedAs(FIELDS.products.otherPhotos)}
      FROM ${ENTITIES.productCategories} AS category
      JOIN ${ENTITIES.products} AS product ON category.id = product.${FIELDS.products.category}
      ORDER BY category.id;
    `) as RowDataPacket[][];
    return products.map(
        (product) => {
	    product.otherPhotos = (product.otherPhotos ? product.otherPhotos.split(",") : []);
	    return product;
	}
    );
  }

  public async fetchProducts(productIDs: number[]): Promise<RowDataPacket[]> {
    const [products] = await this.conn.query(
      `SELECT product.*, ${Object.values(FIELDS.prices).map((v) => "price." + v).join(", ")}
      FROM ${ENTITIES.products} AS product
      JOIN ${ENTITIES.prices} AS price ON price.parent_item_id = product.id
      WHERE price.${FIELDS.prices.isCurrent} = "true" AND product.id IN ?`,
      [[productIDs]]
    ) as RowDataPacket[][];
    return products;
  }

  public async fetchClientOrders(clientID: number): Promise<RowDataPacket[]> {
    const [orders] = await this.conn.execute(
      `SELECT id, date_added FROM ${ENTITIES.orders}
      WHERE ${FIELDS.orders.client} = ?
      ORDER BY date_added DESC`,
      [clientID]
    ) as RowDataPacket[][];
    return orders;
  }

  public async fetchOrderItemsView(orderID: number): Promise<RowDataPacket[]> {
    const [orderItems] = await this.conn.execute(
      `SELECT
        item.${aliasedAs(FIELDS.orderItems.product, "productID")},
        item.${aliasedAs(FIELDS.orderItems.quantity)},
        item.${aliasedAs(FIELDS.orderItems.taxedPrice, "price")},
        product.${aliasedAs(FIELDS.products.photo)},
        product.${aliasedAs(FIELDS.products.article)},
        product.${aliasedAs(FIELDS.products.recomendedMinimalSize)},
        product.${aliasedAs(FIELDS.products.boxSize)},
        product.${aliasedAs(FIELDS.products.packageSize)},
        product.${aliasedAs(FIELDS.products.inStock)},
        product.${aliasedAs(FIELDS.products.isNew)},
        product.${aliasedAs(FIELDS.products.description)},
        product.${aliasedAs(FIELDS.products.review)},
        product.${aliasedAs(FIELDS.products.keywords)},
        product.${aliasedAs(FIELDS.products.otherPhotos)}
      FROM ${ENTITIES.orderItems} as item
      JOIN ${ENTITIES.products} AS product ON item.${FIELDS.orderItems.product} = product.id
      WHERE item.parent_item_id = ?`,
      [orderID]
    ) as RowDataPacket[][];
    return orderItems.map(
        (item) => {
            item.otherPhotos = (item.otherPhotos ? item.otherPhotos.split(",") : []);
            return item;
        }
    );
  }

  public async createOrder(
    title: string,
    clientID: number,
    phoneNumber: string,
    email: string,
    address: string,
    companyName: string,
    inn: string,  // TODO: is it?
    personalDiscount: number,
    comment: string,
    paymentMethod: typeof VALUES.orders.paymentMethod[keyof typeof VALUES.orders.paymentMethod],
    deliveryMethod: typeof VALUES.orders.deliveryMethod[keyof typeof VALUES.orders.deliveryMethod],
    products: {[id: number]: {quantity: number}}
  ): Promise<{orderID: number, items: [RowDataPacket, typeof products[keyof typeof products]][]}> {
    const [insertResult] = await this.conn.query(
      `INSERT INTO ${ENTITIES.orders}(
        parent_id,
        parent_item_id,
        linked_id,
        date_added,
        date_updated,
        created_by,
        sort_order,
        ${FIELDS.orders.title},
        ${FIELDS.orders.client},
        ${FIELDS.orders.phoneNumber},
        ${FIELDS.orders.email},
        ${FIELDS.orders.address},
        ${FIELDS.orders.companyName},
        ${FIELDS.orders.inn},
        ${FIELDS.orders.status},
        ${FIELDS.orders.personalDiscount},
        ${FIELDS.orders.comment},
        ${FIELDS.orders.paymentMethod},
        ${FIELDS.orders.deliveryMethod}
      ) VALUES ?`,
      [[[
        0,
        0,
        0,
        Date.now() / 1000,
        Date.now() / 1000,
        1,
        0,
        title,
        clientID,
        phoneNumber,
        email,
        address,
        companyName,
        inn,
        VALUES.orders.status.new,
        personalDiscount,
        comment,
        paymentMethod,
        deliveryMethod,
      ]]]
    ) as ResultSetHeader[];
    const orderID = insertResult.insertId;

    await this.conn.query(
      `INSERT INTO ${ENTITIES.orders}_values(items_id, fields_id, value) VALUES ?`,
      [[
        [orderID, FIELDS_RAW.orders.client, clientID],
        [orderID, FIELDS_RAW.orders.paymentMethod, paymentMethod],
        [orderID, FIELDS_RAW.orders.deliveryMethod, deliveryMethod],
      ]]
    );

    let fetchedProducts: [RowDataPacket, typeof products[keyof typeof products]][] = (
      (await this.fetchProducts(Object.entries(products).map((product, i) => Number(product[0]))))
      .map((row) => [row, products[row.id]])
    );
    let insertOrderItemsResult = await this.conn.query(
      `INSERT INTO ${ENTITIES.orderItems}(
        parent_id,
        parent_item_id,
        linked_id,
        date_added,
        date_updated,
        created_by,
        sort_order,
        ${FIELDS.orderItems.product},
        ${FIELDS.orderItems.quantity},
        ${FIELDS.orderItems.price},
        ${FIELDS.orderItems.recomendedMinimalSize},
        ${FIELDS.orderItems.amount},
        ${FIELDS.orderItems.boxesCount},
        ${FIELDS.orderItems.boxSize},
        ${FIELDS.orderItems.category},
        ${FIELDS.orderItems.tax},
        ${FIELDS.orderItems.packageSize},
        ${FIELDS.orderItems.article}
      ) VALUES ?`,
      [
        fetchedProducts.map(
          ([product, data], i) => [
            0,
            orderID,
            0,
            Date.now() / 1000,
            Date.now() / 1000,
            1,
            0,
            product.id,
            data.quantity,
            product[FIELDS.prices.discountedPrice],
            product[FIELDS.products.recomendedMinimalSize],
            product[FIELDS.prices.discountedPrice] * data.quantity,
            (new Decimal(data.quantity)).div(product[FIELDS.products.boxSize]).toFixed(6),
            product[FIELDS.products.boxSize],
            product[FIELDS.products.category],  // FIXME: CATEGORY SHOULD BE TRANSLATED
            product[FIELDS.products.tax],
            product[FIELDS.products.packageSize],
            product[FIELDS.products.article]
          ]
        )
      ]
    ) as ResultSetHeader[];

    await this.conn.query(
      `INSERT INTO ${ENTITIES.orderItems}_values (items_id, fields_id, value) VALUES ?`,
      [
        fetchedProducts.map(
          ([product, data], i) => {
            let itemID = insertOrderItemsResult[i];
            return [
              [itemID, FIELDS_RAW.orderItems.product, product.id],
              [itemID, FIELDS_RAW.orderItems.category, product[FIELDS.products.category]],
              [itemID, FIELDS_RAW.orderItems.tax, product[FIELDS.products.tax]]
            ];
          }
        ).flat(1)
      ]
    );

    await this.conn.commit();
    return {orderID: orderID, items: fetchedProducts};
  }

  public async updateClientData(
    clientID: number,
    fullName: string,
    ruPhoneNumber: string,
    address: string,
    companyName: string,
    inn: string
  ): Promise<void> {
    await this.conn.query(
      `UPDATE ${ENTITIES.clients}
      SET
        ${FIELDS.clients.fullName} = ?,
        ${FIELDS.clients.ruPhoneNumber} = ?,
        ${FIELDS.clients.address} = ?,
        ${FIELDS.clients.companyName} = ?,
        ${FIELDS.clients.inn} = ?
      WHERE id = ?;`,
      [
        fullName,
        ruPhoneNumber,
        address,
        companyName,
        inn,
        clientID
      ]
    );
  }

  public async fetchOrderItems(orderID: number): Promise<RowDataPacket[]> {
    const [items] = await this.conn.execute(
      `SELECT * FROM ${ENTITIES.orderItems} WHERE parent_item_id = ?`,
      [orderID]
    ) as RowDataPacket[][];
    return items;
  }

  public async fetchOrder(orderID: number): Promise<RowDataPacket> {
    const [[order]] = await this.conn.execute(
      `SELECT * FROM ${ENTITIES.orders} WHERE id = ?`,
      [orderID]
    ) as RowDataPacket[][];
    return order;
  }

  public async changeOrderStatus(
    orderID: number,
    status: typeof VALUES.orders.status[keyof typeof VALUES.orders.status]
  ): Promise<void> {
    await this.conn.query(
      `UPDATE ${ENTITIES.orders}
      SET ${FIELDS.orders.status} = ?
      WHERE id = ?`,
      [status, orderID]
    );
    await this.conn.commit();
  }
}
