import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { ENTITIES_RAW, FIELDS_RAW, ENTITIES, FIELDS, VALUES } from "common/structures";
import { PoolManager, DBSession as DBSessionOrigin } from "common/db";
import { assert } from "common/utils";

import { config } from "./config";

export enum NotificationType {
  ACCESSIBLE = "accessible",
}

export class DBSession extends DBSessionOrigin {
  public async fetchManagerTgID(): Promise<number> {
    const [rows] = await this.conn.execute(
      `SELECT * FROM ${ENTITIES.users} WHERE id = ?`,
      [config.get("spruton.managerID").toString()]
    ) as RowDataPacket[][];
    assert(rows.length == 1);
    return rows[0][FIELDS.users.tgID];
  }

  // works like ctx manager with for..of
  public async *popNotification(
    clientTgID: number,
    notificationType: NotificationType
  ): AsyncGenerator<boolean, void, void> {
    let [rows] = await this.conn.execute(`
      SELECT notifs.id AS notif_id
      FROM tg_bot_clients_notifications notifs
      LEFT JOIN ${ENTITIES.clients} clients
      ON notifs.client_id = clients.id
      WHERE notifs.type = ? AND clients.${FIELDS.clients.tgID} = ?
    `, [notificationType, clientTgID]) as RowDataPacket[][];
    const value = (rows.length > 0);
    yield value;

    if (!value) { return; }
    await this.conn.query(`
      DELETE FROM tg_bot_clients_notifications
      WHERE id = ?
    `, [rows[0]["notif_id"]]);
  }

  // works like ctx manager with for..of
  public async *popNotifications(
    notificationType: NotificationType
  ):  AsyncGenerator<number[], void, void> {
    let [rows] = await this.conn.execute(`
      SELECT clients.${FIELDS.clients.tgID} AS tg_id, notifs.id AS notif_id
      FROM tg_bot_clients_notifications notifs
      LEFT JOIN ${ENTITIES.clients} clients
      ON notifs.client_id = clients.id
      WHERE notifs.type = ?
    `, [notificationType]) as RowDataPacket[][];
    yield rows.map((v) => v["tg_id"]);

    if (!rows.length) { return; }
    await this.conn.query(`
      DELETE FROM tg_bot_clients_notifications
      WHERE id IN ?
    `, [[rows.map((v) => v["notif_id"])]]);
  }

  public async isUnapproved(clientTgID: number): Promise<boolean> {
    let [rows] = await this.conn.execute(`
      SELECT tg_id FROM tg_bot_clients_approve_queue
      WHERE tg_id = ?
    `, [clientTgID]) as RowDataPacket[][];
    return (rows.length > 0);
  }

  public async addToApproveQueue(clientTgID: number): Promise<void> {
    await this.conn.query(`
      INSERT INTO tg_bot_clients_approve_queue
      VALUES ?
    `, [[[clientTgID]]]);
  }
}

PoolManager.get(
  config,
  async (mngr) => {
    const conn = await mngr.pool.getConnection();
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS tg_bot_published_news (
          id INT NOT NULL,
          PRIMARY KEY (id)
        )
      `);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS tg_bot_clients_notifications (
          id INT NOT NULL AUTO_INCREMENT,
          client_id INT(11) NOT NULL,
          type ENUM(${Object.values(NotificationType).map((v) => `'${v}'`).join(",")}) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE (client_id, type)
        )
      `);
      await conn.execute(`
          CREATE TABLE IF NOT EXISTS tg_bot_clients_approve_queue (
            tg_id BIGINT NOT NULL,
            PRIMARY KEY (tg_id)
          )
      `);
      await conn.commit();

      await conn.query(`DROP TRIGGER IF EXISTS bot_notification_accessible_insert`);
      await conn.query(`
        CREATE TRIGGER bot_notification_accessible_insert
        AFTER INSERT ON ${ENTITIES.clients}
        FOR EACH ROW
        BEGIN
          IF NEW.${FIELDS.clients.status} = ${VALUES.clients.status.active}
            AND NEW.${FIELDS.clients.tgID} != ""
          THEN
            INSERT IGNORE INTO tg_bot_clients_notifications (client_id, type)
              VALUES (NEW.id, 'accessible');
          END IF;
        END
      `);
      await conn.query(`DROP TRIGGER IF EXISTS bot_notification_accessible_update`);
      await conn.query(`
        CREATE TRIGGER bot_notification_accessible_update
        AFTER UPDATE ON ${ENTITIES.clients}
        FOR EACH ROW
        BEGIN
          IF (
            OLD.${FIELDS.clients.status} != ${VALUES.clients.status.active}
            OR OLD.${FIELDS.clients.tgID} != NEW.${FIELDS.clients.tgID}
          ) AND NEW.${FIELDS.clients.status} = ${VALUES.clients.status.active} THEN
            DELETE FROM tg_bot_clients_notifications
              WHERE client_id = OLD.${FIELDS.clients.tgID};
            INSERT IGNORE INTO tg_bot_clients_notifications (client_id, type)
              VALUES (NEW.id, 'accessible');
          END IF;
        END
      `);
      await conn.query(`DROP TRIGGER IF EXISTS bot_notification_accessible_delete`);
      await conn.query(`
        CREATE TRIGGER bot_notification_accessible_delete
        BEFORE DELETE ON ${ENTITIES.clients}
        FOR EACH ROW
        BEGIN
          DELETE FROM tg_bot_clients_notifications
            WHERE client_id = OLD.id;
        END
      `);
      await conn.query(`DROP TRIGGER IF EXISTS bot_approve_queue_refresh_insert`);
      await conn.query(`
        CREATE TRIGGER bot_approve_queue_refresh_insert
        AFTER INSERT ON ${ENTITIES.clients}
        FOR EACH ROW
        BEGIN
          IF NEW.${FIELDS.clients.tgID} != ""
          THEN
            DELETE FROM tg_bot_clients_approve_queue
              WHERE tg_id = NEW.${FIELDS.clients.tgID};
          END IF;
        END
      `);
      await conn.query(`DROP TRIGGER IF EXISTS bot_approve_queue_refresh_update`);
      await conn.query(`
        CREATE TRIGGER bot_approve_queue_refresh_update
        AFTER UPDATE ON ${ENTITIES.clients}
        FOR EACH ROW
        BEGIN
          IF NEW.${FIELDS.clients.tgID} != ""
            AND NEW.${FIELDS.clients.tgID} != OLD.${FIELDS.clients.tgID}
          THEN
            DELETE FROM tg_bot_clients_approve_queue
              WHERE tg_id = NEW.${FIELDS.clients.tgID};
          END IF;
        END
      `);
      await conn.commit();
    } finally {
      if (typeof conn !== "undefined") {
        conn.release();
      }
    }
  }
);
