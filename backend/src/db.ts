import type { RowDataPacket } from "mysql2/promise";

import { ENTITIES, FIELDS, FIELDS_RAW } from "common/dist/structures.js";
import { PoolManager, DBSession as DBSessionOrigin } from "common/dist/db.js";
import { config } from "common/dist/config.js";
import { aliasedAs } from "common/dist/utils.js";

import { ORDER_PLACEHOLDER } from "./structures.js";

export enum NotificationType {
  ACCESSIBLE = "accessible",
}

export class DBSession extends DBSessionOrigin {
  public async fetchAuthClient(email: string, password: string): Promise<RowDataPacket | null> {
    // FIXME: THE HELL? PASSWORD? RLY?
    const [rows] = await this.conn.execute(`
      SELECT * FROM ${ENTITIES.clients}
      WHERE ${FIELDS.clients.email} = ? AND ${FIELDS.clients.password} = ?
    `, [email, password]) as RowDataPacket[][];

    if (rows && rows[0]) {
      return rows[0];
    } else {
      return null;
    }
  }

  public async fetchCategoriesView(): Promise<RowDataPacket[]> {
    const [rows] = await this.conn.execute(
      `SELECT * FROM external_product_categories_list_view`
    ) as RowDataPacket[][];
    return rows;
  }
}

PoolManager.get(
  config,
  async (mngr) => {
    const conn = await mngr.pool.getConnection();
    try {
      let query;
      query = `DROP TRIGGER IF EXISTS bot_rename_order`
      await conn.query(query);
      query = `
        CREATE TRIGGER bot_rename_order
          BEFORE INSERT ON ${ENTITIES.orders}
          FOR EACH ROW
          BEGIN
            IF NEW.${FIELDS.orders.title} = "${ORDER_PLACEHOLDER}" THEN
              SET @auto_id := (
                SELECT AUTO_INCREMENT
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_NAME = "${ENTITIES.orders}" AND TABLE_SCHEMA = DATABASE()
              );
              SET NEW.${FIELDS.orders.title} = CONCAT("Заказ №", @auto_id);
            END IF;
          END
      `;
      await conn.query(query);

      query = `
        CREATE OR REPLACE VIEW external_product_sub_categories_list_view (id, name, types, category_id)
        AS SELECT
          sub_categories_t.id,
          sub_categories_t.${aliasedAs(FIELDS.productSubCategory.name, "name")},
          (
            SELECT IFNULL(
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  "id", types_t.id,
                  "name", types_t.${FIELDS.productType.name}
                )
              ), JSON_ARRAY()
            ) FROM ${ENTITIES.productType} AS types_t
            WHERE types_t.parent_item_id = sub_categories_t.id
          ),
          sub_categories_t.parent_item_id AS category_id
        FROM ${ENTITIES.productSubCategory} AS sub_categories_t;
      `;
      await conn.query(query);
      query = `
        CREATE OR REPLACE VIEW external_product_categories_list_view (id, name, sub_categories)
        AS SELECT
          categories_t.id,
          categories_t.${aliasedAs(FIELDS.productCategory.name, "name")},
          (
            SELECT IFNULL(
              JSON_ARRAYAGG(
                JSON_INSERT(
                  JSON_OBJECT(
                    "id", sub_categories_t.id,
                    "name", sub_categories_t.name
                  ),
                  "$.types", sub_categories_t.types
                )
              ), JSON_ARRAY()
            ) FROM external_product_sub_categories_list_view AS sub_categories_t
            WHERE sub_categories_t.category_id = categories_t.id
          )
        FROM ${ENTITIES.productCategory} AS categories_t;
      `;
      await conn.query(query);
    } finally {
      if (typeof conn !== "undefined") {
        conn.release();
      }
    }
  }
);
