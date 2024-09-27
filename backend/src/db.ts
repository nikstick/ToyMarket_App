import type { RowDataPacket } from "mysql2/promise";

import { ENTITIES, FIELDS } from "common/dist/structures.js";
import { PoolManager, DBSession as DBSessionOrigin } from "common/dist/db.js";
import { config } from "common/dist/config.js";

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
    } finally {
      if (typeof conn !== "undefined") {
        conn.release();
      }
    }
  }
);
