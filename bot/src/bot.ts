import { randomUUID } from "node:crypto";

import { type Context, Bot, Keyboard, InlineKeyboard, session } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { type PhoneNumber, parsePhoneNumber, ParseError } from "libphonenumber-js";
import type { RowDataPacket } from "mysql2/promise";

import type { NewOrder } from "common/dist/ipc.js";
import { ENTITIES_RAW, VALUES } from "common/dist/structures.js";
import { config } from "common/dist/config.js";

import { StaticUtils } from "./utils.js";
import { spruton, storage } from "./controllers.js";
import { DBSession } from "./db.js";

type MyContext = Context & ConversationFlavor;
type MyConversation = Conversation<MyContext>;

export const bot = new Bot<MyContext>(config.get("bot.token"));

bot.api.config.use(autoRetry({maxDelaySeconds: config.get("bot.retryDelay")}));
bot.use(session({
  initial() { return {}; },
}));
bot.use(conversations());

async function inputPhoneNumber(conversation: MyConversation, ctx: MyContext) {
  if (await storage.isUnapproved(ctx.from.id)) {
    await ctx.reply("Ваша заявка уже отправлена");
    return;
  }

  const other = {
    reply_markup: (
      new Keyboard()
      .resized(true).oneTime(true)
      .requestContact("Отправить контакт")
    ),
  };
  await ctx.reply(
    await StaticUtils.renderText("client_unfound", {user: ctx.from}, true),
    other
  );

  let phoneNumber: string;
  while (true) {
    const { message } = await conversation.wait();
    for await (const session of DBSession.ctx()) {
      const clientData = await session.fetchClient(ctx.from.id);
      if (clientData != null) {
        await sendAccessibleNotify(ctx.from.id);
        return;
      }
    }

    if (message.contact) {
      phoneNumber = message.contact.phone_number;
      break;
    } else if (message && message.text && message.text.length <= 20) {
      try {
        let parsedNumber = parsePhoneNumber(message.text);
        if (parsedNumber && parsedNumber.isPossible() && parsedNumber.isValid()) {
          phoneNumber = parsedNumber.formatInternational();
          break;
        }
      } catch (err) {
        if (!(err instanceof ParseError)) { throw err; }
      }
      await ctx.reply("Невозможный номер, попробуйте еще раз.", other);
    } else {
      await ctx.reply("Пожалуйста, введите номер.", other);
    }
  }

  if (config.get("bot.authEnabled")) {
    for await (const session of DBSession.ctx()) {
      await ctx.api.sendMessage(
        await storage.getManagerTgID(),
        await StaticUtils.renderText(
          "new_user",
          {user: ctx.from, number: phoneNumber}
        )
      );
      await session.addToApproveQueue(ctx.from.id);
    }
  } else {
    for await (const session of DBSession.ctx()) {
      let clientID = await session.createClient(
        {
          fullName: `${ctx.from.first_name} ${ctx.from.last_name} (@${ctx.from.username})`,
          tgNick: ctx.from.username,
          tgID: ctx.from.id,
          ruPhoneNumber: phoneNumber,
          status: VALUES.clients.status.active,
          email: "",
          address: "",
          companyName: "",
          password: randomUUID(),
          inn: "",
          personalDiscount: 0
        }
      );
      await spruton.touch(ENTITIES_RAW.clients, clientID);
    }
  }

  if (config.get("bot.authEnabled")) {
    await ctx.reply("Данные успешно отправлены");
  } else {
    await sendAccessibleNotify(ctx.from.id);
  }
}

bot.use(createConversation(inputPhoneNumber));

bot.command("start", async (ctx) => {
  let done: boolean;
  {
    for await (const session of DBSession.ctx()) {
      // TODO: maybe reuse accessible cache
      const clientData = await session.fetchClient(ctx.from.id);

      done = (clientData != null);
    }
  }

  if (done) {
    await sendAccessibleNotify(ctx.from.id);
  } else {
    await ctx.conversation.enter("inputPhoneNumber");
  }
});

bot.on("message", async (ctx) => {
    const msg = ctx.msg;
    if (msg.text && msg.text.startsWith("/")) { return; }
    const mngrID = await storage.getManagerTgID();

    if (msg.from.id != mngrID) {
      await ctx.api.forwardMessage(mngrID, ctx.from.id, msg.message_id);
    } else {
      const replyMsg = msg.reply_to_message;
      if (
        replyMsg
        && replyMsg.forward_origin
        && replyMsg.forward_origin.type == "user"
      ) {
        const me = (await ctx.api.getMe());
        if (
          replyMsg.from.id == me.id
          && replyMsg.forward_origin.sender_user.id != me.id
        ) {
          await ctx.api.copyMessage(
            replyMsg.forward_origin.sender_user.id,
            ctx.from.id,
            msg.message_id,
            // TODO: id field is missing, so no replies
            // {
            //   reply_parameters: {
            //     message_id: reply_msg.forward_from_message_id,
            //     allow_sending_without_reply: true
            //   }
            // }
          );
        }
      }
    }
  }
)

export async function sendAccessibleNotify(clientTgID: number): Promise<void> {
  // TODO: maybe update cache there
  try {
  await bot.api.sendPhoto(
    clientTgID,
    "https://i.imgur.com/hOJ2K0D.jpg",
    {
      caption: await StaticUtils.getText("start"),
      reply_markup: new InlineKeyboard().webApp("Заказать", config.get("bot.webAppURL"))
    }
  );
  } catch (error) {
    console.error(`Error in sending accessible notification to ${clientTgID}:`, error);
  }
}

export async function sendNewOrder(data: NewOrder) {
  try {
    const inlineKeyboard = new InlineKeyboard().webApp(
      "Заказать еще",
      config.get("bot.webAppURL")
    );
    await bot.api.sendMessage(
      data.client.tgID,
      await StaticUtils.renderText("new_order", data, false),
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard,
      }
    );
  } catch (exc) {
    console.error(exc);
  }
}

export async function sendOrderPaid(data: any, client: RowDataPacket) {
  try {
    await bot.api.sendMessage(
      client.tgID,
      await StaticUtils.renderText("order_paid", data, false),
      {parse_mode: "HTML"}
    )
  } catch (exc) {
    console.error(exc);
  }
}

bot.use(
  async (ctx, next) => {
    if (!ctx.from) { return; }
    try {
      for await (const isUnnotified of storage.isAccessibleUnnotified(ctx.from.id)) {
        if (isUnnotified) { sendAccessibleNotify(ctx.from.id); }
      }
    } finally {
      await next();
    }
  }
)

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  console.log(e);
  // why?
  //process.exit(1);
});
