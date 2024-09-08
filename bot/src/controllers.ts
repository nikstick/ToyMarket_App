import { Cache } from "node-ts-cache";

import { Spruton } from "common/controllers.js";

import { cacheStorage } from "./utils.js";
import { config } from "./config.js";
import { DBSession, NotificationType } from "./db.js";

export var spruton = new Spruton(config);

class Storage {
  // works like ctx manager with for..of
  // nested ctx
  public async *isAccessibleUnnotified(
    clientTgID: number
  ): AsyncGenerator<boolean, void, void> {
    // TODO: cache already accessible
    for await (const session of DBSession.ctx()) {
      for await (
        const isUnnotified
        of session.popNotification(clientTgID, NotificationType.ACCESSIBLE)
      ) {
        yield isUnnotified;
      }
    }
  }

  @Cache(cacheStorage, {ttl: 60})
  public async getManagerTgID(): Promise<number> {
    for await (const session of DBSession.ctx()) {
      return await session.fetchManagerTgID();
    }
  }

  @Cache(cacheStorage, {ttl: 300, isLazy: false})
  public async isUnapproved(clientTgID: number): Promise<boolean> {
    for await (const session of DBSession.ctx()) {
      let value = await session.isUnapproved(clientTgID);
      if (!value) { return null as boolean; }
      return value;
    }
  }
}

export var storage = new Storage();
