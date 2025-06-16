import { exit, off } from "node:process";

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

import { ENTITIES_RAW, FIELDS_RAW, VALUES, ENTITIES, FIELDS, FIELD_ALIAS } from "./structures.js";
import { assert, AssertionError, undef, Unpartial } from "./utils.js";
import { FILE } from "node:dns";

interface DBConfigSchema {
  db: {
    host: string
    database: string
    user: string
    password: string,
    extras: Partial<PoolOptions>
  }
}

export function dynamicAlias(field: string, alias?: string, table?: string): [string, string] {
  if (undef(alias)) {
    alias = FIELD_ALIAS[field];
  }
  let aliasing;
  if (alias == null) {
    aliasing = "";
  } else {
    aliasing = `AS ${alias}`
  }

  if (!undef(table)) {
    field = `${table}.${field}`;
  }
  return [field, aliasing];
}

export function aliasedAs(field: string, alias?: string, table?: string): string {
  [field, alias] = dynamicAlias(field, alias, table);
  return `${field} ${alias}`;
}

export function choicesOf(field: string): string {
  return `(
    SELECT IFNULL(JSON_ARRAYAGG(name), JSON_ARRAY())
    FROM app_global_lists_choices
    WHERE FIND_IN_SET(app_global_lists_choices.id, ${field})
  )`;
}

export function nameOfChoice(field: string): string {
  return `(
    SELECT name
    FROM app_global_lists_choices
    WHERE app_global_lists_choices.id = ${field}
  )`;
}

export function strBoolean(field: string, table?: string, alias?: string): string {
  [field, alias] = dynamicAlias(field, alias, table);
  return `IF(${field} = "true", true, IF(${field} = "false", false, NULL)) ${alias}`;
}

export function strForcedNull(field: string, table?: string, alias?: string): string {
  [field, alias] = dynamicAlias(field, alias, table);
  return `NULLIF(${field}, "") ${alias}`;
}

export function numForcedNull(field: string, table?: string, alias?: string): string {
  [field, alias] = dynamicAlias(field, alias, table);
  return `NULLIF(${field}, 0) ${alias}`;
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

  protected async init() {
    const conn = await this.pool.getConnection();
    try {
      let query: string;
      query = `
        CREATE OR REPLACE VIEW external_product_sub_categories_list_view (id, name, types, category_id, \`exists\`, in_stock)
        AS SELECT
          sub_categories_t.id,
          sub_categories_t.${aliasedAs(FIELDS.productSubCategory.name, "name")},
          (
            SELECT IFNULL(
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  "id", types_t.id,
                  "name", types_t.${FIELDS.productType.name},
                  "exists", (SELECT types_t.id IN (SELECT DISTINCT ${FIELDS.products.productType} FROM ${ENTITIES.products})),
                  "in_stock", (
                    SELECT types_t.id IN (
                      SELECT DISTINCT ${FIELDS.products.productType}
                      FROM ${ENTITIES.products}
                      WHERE ${FIELDS.products.inStock} > 0 OR ${FIELDS.products.alwaysInStock} = "true"
                    )
                  )
                )
              ), JSON_ARRAY()
            ) FROM ${ENTITIES.productType} AS types_t
            WHERE types_t.parent_item_id = sub_categories_t.id
          ) AS types,
          sub_categories_t.parent_item_id AS category_id,
          (SELECT sub_categories_t.id IN (SELECT DISTINCT ${FIELDS.products.subCategory} FROM ${ENTITIES.products})) AS 'exists',
          (
            SELECT sub_categories_t.id IN (
              SELECT DISTINCT ${FIELDS.products.subCategory}
              FROM ${ENTITIES.products}
              WHERE ${FIELDS.products.inStock} > 0 OR ${FIELDS.products.alwaysInStock} = "true"
            )
          ) AS in_stock
        FROM ${ENTITIES.productSubCategory} AS sub_categories_t;
      `;
      await conn.query(query);
      query = `
        CREATE OR REPLACE VIEW external_product_categories_list_view (id, name, sub_categories, \`exists\`, in_stock)
        AS SELECT
          categories_t.id,
          categories_t.${aliasedAs(FIELDS.productCategory.name, "name")},
          (
            SELECT IFNULL(
              JSON_ARRAYAGG(
                JSON_INSERT(
                  JSON_OBJECT(
                    "id", sub_categories_t.id,
                    "name", sub_categories_t.name,
                    "exists", sub_categories_t.\`exists\`,
                    "in_stock", sub_categories_t.in_stock
                  ),
                  "$.types", sub_categories_t.types
                )
              ), JSON_ARRAY()
            ) FROM external_product_sub_categories_list_view AS sub_categories_t
            WHERE sub_categories_t.category_id = categories_t.id
          ) AS sub_categories,
          (SELECT categories_t.id IN (SELECT DISTINCT ${FIELDS.products.category} FROM ${ENTITIES.products})) AS 'exists',
          (
            SELECT categories_t.id IN (
              SELECT DISTINCT ${FIELDS.products.category}
              FROM ${ENTITIES.products}
              WHERE ${FIELDS.products.inStock} > 0 OR ${FIELDS.products.alwaysInStock} = "true"
            )
          ) AS in_stock
        FROM ${ENTITIES.productCategory} AS categories_t;
      `;
      await conn.query(query);

      query = `
        CREATE OR REPLACE VIEW external_products_view
        AS SELECT
          product.id AS id,
          productType.id as productTypeID,
          productType.${aliasedAs(FIELDS.productType.name, "productTypeName")},
          category.id AS categoryID,
          category.${aliasedAs(FIELDS.productCategory.name, "categoryName")},
          subCategory.id AS subCategoryID,
          subCategory.${aliasedAs(FIELDS.productSubCategory.name, "subCategoryName")},
          product.${aliasedAs(FIELDS.products.photo)},
          product.${aliasedAs(FIELDS.products.article)},
          ${strForcedNull(FIELDS.products.name, "product")},
          product.${aliasedAs(FIELDS.products.price)},
          product.${aliasedAs(FIELDS.products.discountedPrice)},
          product.${aliasedAs(FIELDS.products.recomendedMinimalSize)},
          product.${aliasedAs(FIELDS.products.boxSize)},
          product.${aliasedAs(FIELDS.products.packageSize)},
          product.${aliasedAs(FIELDS.products.inStock)},
          ${strBoolean(FIELDS.products.isNew, "product")},
          product.${aliasedAs(FIELDS.products.description)},
          product.${aliasedAs(FIELDS.products.review)},
          product.${aliasedAs(FIELDS.products.keywords, "keywordsIDs")},
          ${choicesOf("keywordsIDs")} AS keywords,
          product.${aliasedAs(FIELDS.products.otherPhotos)},
          ${strForcedNull(FIELDS.products.rutubeReview, "product")},
          ${strForcedNull(FIELDS.products.textColor, "product")},
          ${strBoolean(FIELDS.products.isSiteViewable, "product")},
          ${strForcedNull(FIELDS.products.modelID, "product")},
          ${strForcedNull(FIELDS.products.modelName, "product")},
          ${strForcedNull(FIELDS.products.material, "product")},
          ${numForcedNull(FIELDS.products.minKidAge, "product", "minKidAgeID")},
          ${nameOfChoice("minKidAgeID")} AS minKidAge,
          ${numForcedNull(FIELDS.products.maxKidAge, "product", "maxKidAgeID")},
          ${nameOfChoice("maxKidAgeID")} AS maxKidAge,
          ${numForcedNull(FIELDS.products.kidGender, "product", "kidGenderID")},
          ${nameOfChoice("kidGenderID")} AS kidGender,
          ${numForcedNull(FIELDS.products.color, "product", "colorID")},
          ${nameOfChoice("colorID")} AS color,
          ${strBoolean(FIELDS.products.alwaysInStock, "product")},
          ${strBoolean(FIELDS.products.preorder, "product")},
          product.${aliasedAs(FIELDS.products.preorderConditions)},
          product.${aliasedAs(FIELDS.products.storeDeliveryInDays)},
          product.${aliasedAs(FIELDS.products.prepayPercent)},
          product.${aliasedAs(FIELDS.products.prepayAmount)},
          ${strBoolean(FIELDS.products.WBAccessible, "product")},
          product.${aliasedAs(FIELDS.products.WBURL)},
          ${strBoolean(FIELDS.products.OzonAccessible, "product")},
          product.${aliasedAs(FIELDS.products.OzonURL)},
          ${strBoolean(FIELDS.products.AvitoAccessible, "product")},
          product.${aliasedAs(FIELDS.products.AvitoURL)},
          ${strBoolean(FIELDS.products.YaMarketAccessible, "product")},
          product.${aliasedAs(FIELDS.products.YaMarketURL)},
          ${strBoolean(FIELDS.products.recomendedMinimalSizeEnabled, "product")},
          ${nameOfChoice(FIELDS.products.sizeUnit)} AS sizeUnit,
          tradeMark.id AS tradeMarkID,
          tradeMark.${aliasedAs(FIELDS.tradeMarks.name, "tradeMarkName")},
          tradeMark.${aliasedAs(FIELDS.tradeMarks.logo, "tradeMarkLogo")},
          tradeMark.${aliasedAs(FIELDS.tradeMarks.about, "tradeMarkAbout")},
          shoeSize.${aliasedAs(FIELDS.shoeSizes.name, "shoeSizeName")},
          shoeSize.${aliasedAs(FIELDS.shoeSizes.cls, "shoeSizeClassID")},
          ${nameOfChoice("shoeSizeClassID")} AS shoeSizeClass,
          shoeSize.${aliasedAs(FIELDS.shoeSizes.length, "shoeSizeLength")},
          shoeSize.${aliasedAs(FIELDS.shoeSizes.ruSize, "shoeSizeRu")},
          shoeSize.${aliasedAs(FIELDS.shoeSizes.euSize, "shoeSizeEu")},
          country.id AS producingCountryID,
          country.${aliasedAs(FIELDS.countries.shortName, "producingCountry")},
          country.${aliasedAs(FIELDS.countries.enName, "producingCountryEnName")},
          country.${aliasedAs(FIELDS.countries.fullName, "producingCountryFullName")}
        FROM ${ENTITIES.products} AS product
        LEFT JOIN ${ENTITIES.productType} AS productType ON productType.id = product.${FIELDS.products.productType}
        LEFT JOIN ${ENTITIES.productCategory} AS category ON category.id = product.${FIELDS.products.category}
        LEFT JOIN ${ENTITIES.productSubCategory} AS subCategory ON subCategory.id = product.${FIELDS.products.subCategory}
        LEFT JOIN ${ENTITIES.tradeMarks} AS tradeMark ON tradeMark.id = product.${FIELDS.products.tradeMark}
        LEFT JOIN ${ENTITIES.shoeSizes} AS shoeSize ON shoeSize.id = product.${FIELDS.products.shoeSize}
        LEFT JOIN ${ENTITIES.country} AS country ON country.id = product.${FIELDS.products.producingCountry};
      `;
      conn.query(query);
    } finally {
      if (!undef(conn)) {
        conn.release();
      }
    }
  }
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
    } else if (err.message.includes("because of inactivity.")) {
      ;
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
      if (!undef(conn)) {
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

  public async fetchProductsView(
    opts: Partial<{
      ids: number[] | undefined,
      modelID: string | undefined,
      categoryID: number | undefined,
      subCategoryID: number | undefined,
      productTypeID: number | undefined,
      limit: number,
      offset: number,
      random: boolean,
      inStock: boolean | undefined,
      isNew: boolean | undefined,
      searchMatch: string[],
      extraFieldCondition: {[field: string]: any}
    }> = {}
  ): Promise<RowDataPacket[]> {
    const defaultOpts = {
      limit: 200,
      offset: 0,
      random: false,
      extraFieldCondition: {},
      searchMatch: []
    };
    opts = Object.assign(structuredClone(defaultOpts), opts);

    let params: any[] = [];
    let extraConditions: string[] = [];
    if (!undef(opts.ids)) {
      params.push([opts.ids.map(Number)]);
      extraConditions.push("id IN ?");
    }
    if (!undef(opts.modelID)) {
      params.push(opts.modelID);
      extraConditions.push("modelID = ?");
    }
    if (!undef(opts.productTypeID)) {
      params.push(opts.productTypeID);
      extraConditions.push("productTypeID = ?");
    }
    if (opts.isNew == true || opts.categoryID == -1) {
      extraConditions.push("isNew");
    }
    if (opts.isNew == false) {
      extraConditions.push("NOT isNew");
    }
    if (!undef(opts.categoryID) && opts.categoryID != -1) {
      params.push(opts.categoryID);
      extraConditions.push("categoryID = ?");
    }
    if (!undef(opts.subCategoryID)) {
      params.push(opts.subCategoryID);
      extraConditions.push("subCategoryID = ?");
    }
    if (!undef(opts.productTypeID)) {
      params.push(opts.productTypeID);
      extraConditions.push("productTypeID = ?");
    }
    if (!undef(opts.inStock)) {
      extraConditions.push(`${opts.inStock ? "" : "NOT"} (inStock > 0 OR alwaysInStock)`);
    }
    Object.entries(opts.extraFieldCondition).forEach(
      ([k, v]) => {
        params.push(v);
        extraConditions.push(`${k} = ?`);
      }
    )

    // search
    if (opts.searchMatch.length > 0) {
      var searchQuery = `
        SELECT id
        FROM ${ENTITIES.products}
        WHERE CONCAT(",", ${FIELDS.products.keywords}, ",") REGEXP CONCAT(
          "(",
          (
            SELECT GROUP_CONCAT(id SEPARATOR "|")
            FROM app_global_lists_choices
            WHERE lists_id = (
              SELECT configuration->>'$.use_global_list'
              FROM app_fields
              WHERE id = ${FIELDS_RAW.products.keywords}
            ) AND name != ""
            AND MATCH (name) AGAINST (?)
          ),
          ")"
        ) OR (
          ${FIELDS.products.name} != ""
          AND MATCH (${FIELDS.products.name}) AGAINST (?)
        ) OR (
          ${FIELDS.products.article} != ""
          AND MATCH (${FIELDS.products.article}) AGAINST (?)
        )
      `;
      let text = opts.searchMatch.join(" ");
      params.push(text, text, text);
    }

    params.push(Number(opts.limit), Number(opts.offset));
    const [products] = await this.conn.query(`
      SELECT *
      FROM external_products_view
      WHERE isSiteViewable
      ${extraConditions.map((v) => "AND " + v).join("\n")}
      ${!undef(searchQuery) ? `AND id IN (${searchQuery})` : ""}
      ${opts.random ? "ORDER BY rand()" : ""}
      LIMIT ? OFFSET ?
      `, params
    ) as RowDataPacket[][];
    return products.map(
      (product) => {
        product.otherPhotos = (product.otherPhotos ? product.otherPhotos.split(",") : []);
        product.keywordsIDs = (product.keywordsIDs ? product.keywordsIDs.split(",") : []);
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

  public async fetchClientOrders(clientID: number, limit: number = 20, offset: number = 0): Promise<RowDataPacket[]> {
    const [orders] = await this.conn.execute(`
      SELECT
        id,
        date_added,
        ${aliasedAs(FIELDS.orders.status)},
        ${nameOfChoice("status")} AS statusName,
        ${aliasedAs(FIELDS.orders.discountPercent)},
        ${numForcedNull(FIELDS.orders.code)},
        ${aliasedAs(FIELDS.orders.discountPercent)},
        ${aliasedAs(FIELDS.orders.address)},
        ${aliasedAs(FIELDS.orders.paymentMethod, "paymentMethodID")},
        ${nameOfChoice("paymentMethodID")} AS paymentMethod,
        ${aliasedAs(FIELDS.orders.deliveryMethod, "deliveryMethodID")},
        ${nameOfChoice("deliveryMethodID")} AS deliveryMethod,
        ${strForcedNull(FIELDS.orders.pickupPoint, undefined, "pickupPointID")},
        ${strForcedNull(FIELDS.orders.trackNumber)},
        ${strForcedNull(FIELDS.orders.transportCompany)}
      FROM ${ENTITIES.orders}
      WHERE ${FIELDS.orders.client} = ?
      ORDER BY date_added DESC
      LIMIT ? OFFSET ?
      `, [clientID, String(limit), String(offset)]
    ) as RowDataPacket[][];
    return orders;
  }

  public async fetchOrderItemsView(orderIDs: number[]): Promise<RowDataPacket[]> {
    if (orderIDs.length == 0) {
      return [];
    }

    const [orderItems] = await this.conn.query(
      `SELECT
        product.*,
        item.id AS id,
        item.parent_item_id AS orderID,
        item.${aliasedAs(FIELDS.orderItems.product, "productID")},
        item.${aliasedAs(FIELDS.orderItems.quantity)},
        item.${aliasedAs(FIELDS.orderItems.discountedPrice, "discountedPrice")},
        item.${aliasedAs(FIELDS.orderItems.price, "price")},
        item.${aliasedAs(FIELDS.orderItems.amount, "amount")}
      FROM ${ENTITIES.orderItems} as item
      LEFT JOIN external_products_view AS product ON item.${FIELDS.orderItems.product} = product.id
      WHERE item.parent_item_id IN ?`,
      [[orderIDs]]
    ) as RowDataPacket[][];
    return orderItems.map(
        (item) => {
            item.otherPhotos = (item.otherPhotos ? item.otherPhotos.split(",") : []);
            item.keywordsIDs = (item.keywordsIDs ? item.keywordsIDs.split(",") : []);
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
    fullName: string,
    personalDiscount: number,
    comment: string,
    paymentMethod: typeof VALUES.orders.paymentMethod[keyof typeof VALUES.orders.paymentMethod],
    deliveryMethod: typeof VALUES.orders.deliveryMethod[keyof typeof VALUES.orders.deliveryMethod],
    pickupPoint: number | null,
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
        ${FIELDS.orders.fullName},
        ${FIELDS.orders.status},
        ${FIELDS.orders.discountPercent},
        ${FIELDS.orders.comment},
        ${FIELDS.orders.paymentMethod},
        ${FIELDS.orders.deliveryMethod},
        ${FIELDS.orders.pickupPoint}
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
        fullName,
        VALUES.orders.status.new,
        personalDiscount,
        comment,
        paymentMethod,
        deliveryMethod,
        (undef(pickupPoint) ? "" : pickupPoint),
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
    tgPhoneNumber: string,
    address: string,
    companyName: string,
    inn: string
  ): Promise<void> {
    await this.conn.query(
      `UPDATE ${ENTITIES.clients}
      SET
        ${FIELDS.clients.fullName} = ?,
        ${FIELDS.clients.tgPhoneNumber} = ?,
        ${FIELDS.clients.address} = ?,
        ${FIELDS.clients.companyName} = ?,
        ${FIELDS.clients.inn} = ?
      WHERE id = ?;`,
      [
        fullName,
        tgPhoneNumber,
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
    const [[order]] = await this.conn.execute(`
      SELECT
        *,
        ${nameOfChoice("status")} AS statusName
      FROM ${ENTITIES.orders}
      WHERE id = ?
      `, [orderID]
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
        ${FIELDS.clients.tgPhoneNumber},
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
          data.tgPhoneNumber,
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
    assert(!undef(client));
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

  public async fetchCategoriesView(exists: boolean = false, inStock: boolean = false): Promise<RowDataPacket[]> {
    let field = null;
    if (exists) {
      field = "exists";
    }
    if (inStock) {
      field = "in_stock";
    }

    let [rows] = await this.conn.execute(`
      SELECT * FROM external_product_categories_list_view
      ${field == null ? "" : `WHERE \`${field}\``}
    `) as RowDataPacket[][];
    if (field != null) {
      rows.forEach(
        (cat) => {
          cat.sub_categories = cat.sub_categories.filter(x => x[field]).map(
            (subCat) => {
              subCat.types = subCat.types.filter(x => x[field]);
              return subCat;
            }
          );
        }
      );
    }
    return rows;
  }

  public async fetchRetailOutlet(id: number): Promise<RowDataPacket> {
    let [[outlet]] = await this.conn.execute(`
      SELECT * FROM ${ENTITIES.retailOutlets}
      WHERE id = ?
    `, id) as RowDataPacket[][];
    assert(!undef(outlet));
    return outlet;
  }

  public async fetchRetailOutletsView(): Promise<RowDataPacket[]> {
    let [rows] = await this.conn.execute(`
      SELECT
        id,
        ${aliasedAs(FIELDS.retailOutlets.name)},
        ${aliasedAs(FIELDS.retailOutlets.address)},
        ${aliasedAs(FIELDS.retailOutlets.openingTime)},
        ${aliasedAs(FIELDS.retailOutlets.closingTime)},
        ${aliasedAs(FIELDS.retailOutlets.deliveryTime)},
        ${strBoolean(FIELDS.retailOutlets.pickupPointStatus)}
      FROM ${ENTITIES.retailOutlets}
      WHERE ${FIELDS.retailOutlets.pickupPointStatus} = "true"
    `) as RowDataPacket[][];
    return rows;
  }
}
