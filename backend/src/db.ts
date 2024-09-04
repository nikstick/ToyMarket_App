import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { ENTITIES_RAW, FIELDS_RAW, ENTITIES, FIELDS, VALUES } from "common/structures";
import { PoolManager, DBSession as DBSessionOrigin } from "common/db";
import { assert } from "common/utils";

import { config } from "./config";
import { ORDER_PLACEHOLDER } from "./structures";

export enum NotificationType {
  ACCESSIBLE = "accessible",
}

export class DBSession extends DBSessionOrigin {}

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
          BEFORE INSERT ON app_entity_27
          FOR EACH ROW
          BEGIN
            IF NEW.field_234 = "${ORDER_PLACEHOLDER}" THEN
              SET @auto_id := (
                SELECT AUTO_INCREMENT
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_NAME = "app_entity_27" AND TABLE_SCHEMA = DATABASE()
              );
              SET NEW.field_234 = CONCAT("Заказ №", @auto_id);
            END IF;
          END
      `;
      await conn.query(query);
    } finally {
      if (typeof conn !== "undefined") {
        conn.release();
      }
    }
  }
);
