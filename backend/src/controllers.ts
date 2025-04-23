import type { RowDataPacket } from "mysql2/promise";
import { Cache } from "node-ts-cache";
import ipc from "node-ipc";
import { TinkoffCheckout } from "@exode-team/tinkoff.checkout";

import { Spruton } from "common/dist/controllers.js";
import { config } from "common/dist/config.js";

import { DBSession } from "./db.js";
import { cacheStorage, uselessFront } from "./utils.js";

export var spruton = new Spruton(config);

ipc.config.id = "backend";
ipc.config.retry = 2 * 60 * 1000;
ipc.connectTo("bot");

export var tinkoff = new TinkoffCheckout(
  config.get("tinkoff.terminalKey"),
  config.get("tinkoff.secretKey")
);
