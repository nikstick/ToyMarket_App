import type { Socket } from "node:net";

import ipc from "node-ipc";

import { FIELDS_RAW, FIELDS } from "common/structures.js";
import type { NewOrder } from "common/ipc.js";

import { DBSession, NotificationType } from "./db.js";
import { spruton } from "./controllers.js";
import { bot, sendAccessibleNotify, sendNewOrder } from "./bot.js";

async function performBroadcast() {
  for await (const session of DBSession.ctx()) {
    for await (const news of session.popNews()) {
      if (!news.length) { continue; }
      let users = await session.fetchBroadcastableClients();
      if (!users.length) { continue; }
      let newsApiData = await spruton.fetchNews(news.map(x => x.id));

      for (const newsItem of news) {
        const newsText = `${newsItem[FIELDS.news.text]}`;
        let newsImg: string | undefined;
        if (newsItem[FIELDS.news.img]) {
          newsImg = spruton.imageURL(newsApiData[newsItem.id], FIELDS_RAW.news.img);
        }

        for (const user of users) {
          const userTgID = user[FIELDS.clients.tgID];
          try {
            if (newsImg) {
              await bot.api.sendPhoto(userTgID, newsImg, {caption: `${newsText}`});
            } else {
              await bot.api.sendMessage(userTgID, newsText)
            }
          } catch (error) {
            console.error(`Error in sending news to ${userTgID}:`, error);
          }
        }
      }
    }
  }
}

setTimeout(performBroadcast, 5 * 1000);
setInterval(performBroadcast, 30 * 1000);

async function performAccessibleNotify() {
  for await (const session of DBSession.ctx()) {
    for await (const notifs of session.popNotifications(NotificationType.ACCESSIBLE)) {
      for (const tgID of notifs) {
        await sendAccessibleNotify(tgID);
      }
    }
  }
}

setTimeout(performAccessibleNotify, 5 * 1000)
setInterval(performAccessibleNotify, 60 * 1000);

ipc.config.id = "bot";
ipc.serve(
  () => {
    ipc.server.on(
      "newOrder",
      (data: NewOrder, socket: Socket) => {
        sendNewOrder(data).then();
      }
    )
  }
);
