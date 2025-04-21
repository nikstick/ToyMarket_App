import { exit } from "node:process";

import {
  type PoolOptions,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
  type ErrorPacketParams,
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

export function choicesOf(field: string): string {
  return `(
    SELECT JSON_ARRAYAGG(name)
    FROM app_global_lists_choices
    WHERE FIND_IN_SET(app_global_lists_choices.id, ${field})
  )`;
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
    conn.removeListener("error", DBSession.errorHandler);
    conn.on("error", DBSession.errorHandler);
  }

  public static errorHandler(err: ErrorPacketParams) {
    if (
      err.code == "PROTOCOL_CONNECTION_LOST"
      && !err.message.trim().startsWith("Connection lost: The server closed the connection")
    ) {
      console.error(`DB CONNECTION ERROR: ${err.message}`);
      exit(1);
    } else {
      console.error(err.message);
    }
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

  public async fetchProductsViewByModel(model: string): Promise<RowDataPacket[]> {
    const [result] = await this.conn.execute(`
      SELECT id FROM ${ENTITIES.products}
      WHERE ${FIELDS.products.modelName} = ?
    `, [model]) as RowDataPacket[][];
    return await this.fetchProductsView(result.map((product) => product.id));
  }

  public async fetchProductsView(ids: number[] | null = null): Promise<RowDataPacket[]> {
    const [products] = await this.conn.query(`
      SELECT
        product.id AS id,
        productType.id as productTypeID,
        productType.${aliasedAs(FIELDS.productType.name, "productTypeName")},
        category.id AS categoryID,
        category.${aliasedAs(FIELDS.productCategory.name, "categoryName")},
        subCategory.id AS subCategoryID,
        subCategory.${aliasedAs(FIELDS.productSubCategory.name, "subCategoryName")},
        product.${aliasedAs(FIELDS.products.photo)},
        product.${aliasedAs(FIELDS.products.article)},
        product.${aliasedAs(FIELDS.products.price)},
        product.${aliasedAs(FIELDS.products.discountedPrice)},
        product.${aliasedAs(FIELDS.products.recomendedMinimalSize)},
        product.${aliasedAs(FIELDS.products.boxSize)},
        product.${aliasedAs(FIELDS.products.packageSize)},
        product.${aliasedAs(FIELDS.products.inStock)},
        product.${aliasedAs(FIELDS.products.isNew)},
        product.${aliasedAs(FIELDS.products.description)},
        product.${aliasedAs(FIELDS.products.review)},
        product.${aliasedAs(FIELDS.products.keywords, "keywordsIDs")},
        ${choicesOf("keywordsIDs")} AS keywords,
        product.${aliasedAs(FIELDS.products.otherPhotos)},
        product.${aliasedAs(FIELDS.products.rutubeReview)},
        product.${aliasedAs(FIELDS.products.textColor)},
        product.${aliasedAs(FIELDS.products.status)},
        product.${aliasedAs(FIELDS.products.modelName)},
        product.${aliasedAs(FIELDS.products.producingCountry)},
        product.${aliasedAs(FIELDS.products.minKidAge)},
        product.${aliasedAs(FIELDS.products.maxKidAge)},
        product.${aliasedAs(FIELDS.products.kidGender)},
        product.${aliasedAs(FIELDS.products.color)},
        tradeMark.id AS tradeMarkID,
        tradeMark.${aliasedAs(FIELDS.tradeMarks.name, "tradeMarkName")},
        tradeMark.${aliasedAs(FIELDS.tradeMarks.logo, "tradeMarkLogo")},
        tradeMark.${aliasedAs(FIELDS.tradeMarks.about, "tradeMarkAbout")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.name, "shoeSizeName")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.cls, "shoeSizeClass")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.length, "shoeSizeLength")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.ruSize, "shoeSizeRu")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.euSize, "shoeSizeEu")}
      FROM ${ENTITIES.products} AS product
      LEFT JOIN ${ENTITIES.productType} AS productType ON productType.id = product.${FIELDS.products.productType}
      LEFT JOIN ${ENTITIES.productCategory} AS category ON category.id = product.${FIELDS.products.category}
      LEFT JOIN ${ENTITIES.productSubCategory} AS subCategory ON subCategory.id = product.${FIELDS.products.subCategory}
      LEFT JOIN ${ENTITIES.tradeMarks} AS tradeMark ON tradeMark.id = product.${FIELDS.products.tradeMark}
      LEFT JOIN ${ENTITIES.shoeSizes} AS shoeSize ON shoeSize.id = product.${FIELDS.products.shoeSize}
      WHERE product.${FIELDS.products.status} != ${VALUES.products.status.inactive}
      ${ids == null ? "" : "AND product.id IN ?"}
      ORDER BY category.id;
      `, (ids == null ? undefined : [[ids]])
    ) as RowDataPacket[][];
    return products.map(
      (product) => {
        product.otherPhotos = (product.otherPhotos ? product.otherPhotos.split(",") : []);
        product.keywordsIDs = (product.keywordsIDs ? product.keywordsIDs.split(",") : []);
        product.keywords = (product.keywords ? JSON.parse(product.keywords) : []);
        return product;
      }
    );
  }

  public async fetchProducts(productIDs: number[]): Promise<RowDataPacket[]> {
    const [products] = await this.conn.query(
      `SELECT product.*
      FROM ${ENTITIES.products} AS product
      WHERE product.id IN ?`,
      [[productIDs]]
    ) as RowDataPacket[][];
    return products;
  }

  public async fetchClientOrders(clientID: number): Promise<RowDataPacket[]> {
    const [orders] = await this.conn.execute(
      `SELECT id, date_added, ${aliasedAs(FIELDS.orders.personalDiscount)} FROM ${ENTITIES.orders}
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
        item.${aliasedAs(FIELDS.orderItems.discountedPrice, "discountedPrice")},
        item.${aliasedAs(FIELDS.orderItems.price, "price")},
        item.${aliasedAs(FIELDS.orderItems.amount, "amount")},
        subCategory.${aliasedAs(FIELDS.productSubCategory.name, "subCategoryName")},
        product.${aliasedAs(FIELDS.products.photo)},
        product.${aliasedAs(FIELDS.products.article)},
        product.${aliasedAs(FIELDS.products.recomendedMinimalSize)},
        product.${aliasedAs(FIELDS.products.boxSize)},
        product.${aliasedAs(FIELDS.products.packageSize)},
        product.${aliasedAs(FIELDS.products.inStock)},
        product.${aliasedAs(FIELDS.products.isNew)},
        product.${aliasedAs(FIELDS.products.description)},
        product.${aliasedAs(FIELDS.products.review)},
        product.${aliasedAs(FIELDS.products.keywords, "keywordsIDs")},
        ${choicesOf("keywordsIDs")} AS keywords,
        product.${aliasedAs(FIELDS.products.otherPhotos)},
        product.${aliasedAs(FIELDS.products.rutubeReview)},
        product.${aliasedAs(FIELDS.products.textColor)},
        product.${aliasedAs(FIELDS.products.status)},
        product.${aliasedAs(FIELDS.products.modelName)},
        product.${aliasedAs(FIELDS.products.producingCountry)},
        product.${aliasedAs(FIELDS.products.minKidAge)},
        product.${aliasedAs(FIELDS.products.maxKidAge)},
        product.${aliasedAs(FIELDS.products.kidGender)},
        product.${aliasedAs(FIELDS.products.color)},
        tradeMark.id AS tradeMarkID,
        tradeMark.${aliasedAs(FIELDS.tradeMarks.name, "tradeMarkName")},
        tradeMark.${aliasedAs(FIELDS.tradeMarks.logo, "tradeMarkLogo")},
        tradeMark.${aliasedAs(FIELDS.tradeMarks.about, "tradeMarkAbout")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.name, "shoeSizeName")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.cls, "shoeSizeClass")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.length, "shoeSizeLength")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.ruSize, "shoeSizeRu")},
        shoeSize.${aliasedAs(FIELDS.shoeSizes.euSize, "shoeSizeEu")}
      FROM ${ENTITIES.products} AS product
      LEFT JOIN ${ENTITIES.orderItems} as item ON item.${FIELDS.orderItems.product} = product.id
      LEFT JOIN ${ENTITIES.productSubCategory} AS subCategory ON subCategory.id = product.${FIELDS.products.subCategory}
      LEFT JOIN ${ENTITIES.tradeMarks} AS tradeMark ON tradeMark.id = product.${FIELDS.products.tradeMark}
      LEFT JOIN ${ENTITIES.shoeSizes} AS shoeSize ON shoeSize.id = product.${FIELDS.products.shoeSize}
      WHERE item.parent_item_id = ?`,
      [orderID]
    ) as RowDataPacket[][];
    return orderItems.map(
        (item) => {
            item.otherPhotos = (item.otherPhotos ? item.otherPhotos.split(",") : []);
            item.keywordsIDs = (item.keywordsIDs ? item.keywordsIDs.split(",") : []);
            item.keywords = (item.keywords ? JSON.parse(item.keywords) : []);
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
  ): Promise<{orderID: number, itemIDs: number[], products: [RowDataPacket, typeof products[keyof typeof products]][]}> {
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
    let insertOrderItemsIDs = await Promise.all(
      fetchedProducts.map(
        async ([product, data], i) => {
          let [insertResult] = await this.conn.query(
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
              ${FIELDS.orderItems.discountedPrice},
              ${FIELDS.orderItems.recomendedMinimalSize},
              ${FIELDS.orderItems.amount},
              ${FIELDS.orderItems.tax},
              ${FIELDS.orderItems.packageSize},
              ${FIELDS.orderItems.article}
            ) VALUES ?`,
            [[[
              0,
              orderID,
              0,
              Date.now() / 1000,
              Date.now() / 1000,
              1,
              0,
              product.id,
              data.quantity,
              product[FIELDS.products.price],
              product[FIELDS.products.discountedPrice],
              product[FIELDS.products.recomendedMinimalSize],
              product[FIELDS.products.discountedPrice] * data.quantity,
              product[FIELDS.products.tax],
              product[FIELDS.products.packageSize],
              product[FIELDS.products.article]
            ]]]
            ) as ResultSetHeader[];
            return insertResult.insertId;
        }
      )
    );

    await this.conn.query(
      `INSERT INTO ${ENTITIES.orderItems}_values (items_id, fields_id, value) VALUES ?`,
      [
        fetchedProducts.map(
          ([product, data], i) => {
            let itemID = insertOrderItemsIDs[i];
            return [
              [itemID, FIELDS_RAW.orderItems.product, product.id],
              [itemID, FIELDS_RAW.orderItems.tax, product[FIELDS.products.tax]]
            ];
          }
        ).flat(1)
      ]
    );

    await this.conn.commit();
    return {
      orderID: orderID,
      itemIDs: insertOrderItemsIDs,
      products: fetchedProducts
    };
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

  public async fetchOrderItemsIDs(orderID: number): Promise<RowDataPacket[]> {
    const [items] = await this.conn.execute(
      `SELECT id FROM ${ENTITIES.orderItems} WHERE parent_item_id = ?`,
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

  public async createClient(data: {[k in keyof typeof FIELDS.clients]: string | number}): Promise<number> {
    const [insertResult] = await this.conn.query(
      `INSERT INTO ${ENTITIES.clients} (
        ${FIELDS.clients.fullName},
        ${FIELDS.clients.ruPhoneNumber},
        ${FIELDS.clients.email},
        ${FIELDS.clients.companyName},
        ${FIELDS.clients.status},
        ${FIELDS.clients.inn},
        ${FIELDS.clients.tgID},
        ${FIELDS.clients.personalDiscount},
        ${FIELDS.clients.tgNick}
      ) VALUES ?`,
      [[
        [
          data.fullName,
          data.ruPhoneNumber,
          data.email,
          data.companyName,
          data.status,
          data.inn,
          data.tgID,
          data.personalDiscount,
          data.tgNick
        ]
      ]]
    ) as ResultSetHeader[];
    await this.conn.commit();
    return insertResult.insertId;
  }

  public async fetchClientBySprutonID(clientID: number): Promise<RowDataPacket> {
    const [[client]] = await this.conn.execute(
      `SELECT * FROM ${ENTITIES.clients} WHERE id = ?`,
      clientID
    ) as RowDataPacket[][];
    return client;
  }

  public async fetchClientByOrder(orderID: number): Promise<RowDataPacket> {
    const [[result]] = await this.conn.execute(
      `SELECT value FROM ${ENTITIES.orders}_values
      WHERE items_id = ?
      AND fields_id = ${FIELDS_RAW.orders.client}`,
      orderID
    ) as RowDataPacket[][];
    return await this.fetchClientBySprutonID(result.value);
  }
}
