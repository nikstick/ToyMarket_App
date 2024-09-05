import { type PoolOptions, type Pool, type PoolConnection, type RowDataPacket, createPool} from "mysql2/promise";
import type { Config } from "convict";

import { ENTITIES_RAW, FIELDS_RAW, VALUES, ENTITIES, FIELDS } from "./structures";
import { aliasedAs, assert, AssertionError } from "./utils";

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

  public async fetchClient(clientTgID: number): Promise<{[key: string]: any} | null> {
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
      item.${aliasedAs(FIELDS.order_items.product, "productID")},
      item.${aliasedAs(FIELDS.order_items.quantity)},
      item.${aliasedAs(FIELDS.order_items.taxed_price, "price")},
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
      FROM ${ENTITIES.order_items} as item
      WHERE item.parent_item_id = ?
      JOIN ${ENTITIES.products} AS product ON item.productID = product.id`,
      [orderID]
    ) as RowDataPacket[][];
    return orderItems;
  }
}
