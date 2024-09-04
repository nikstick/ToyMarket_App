import { type Context, Bot, Keyboard, InlineKeyboard, session } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { type PhoneNumber, parsePhoneNumber, ParseError } from "libphonenumber-js";

import { config } from "./config";
import { StaticUtils } from "./utils";
import { storage } from "./controllers";
import { DBSession } from "./db";

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

  let number: string;
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
      number = message.contact.phone_number;
      break;
    } else if (message && message.text && message.text.length <= 20) {
      try {
        let parsedNumber = parsePhoneNumber(message.text);
        if (parsedNumber && parsedNumber.isPossible() && parsedNumber.isValid()) {
          number = parsedNumber.formatInternational();
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

  for await (const session of DBSession.ctx()) {
    await ctx.api.sendMessage(
      await storage.getManagerTgID(),
      await StaticUtils.renderText(
        "new_user",
        {user: ctx.from, number: number}
      )
    );
    await session.addToApproveQueue(ctx.from.id);
    await ctx.reply("Данные успешно отправлены");
  }
}

bot.use(createConversation(inputPhoneNumber));

bot.command("start", async (ctx) => {
  for await (const session of DBSession.ctx()) {
    // TODO: maybe reuse accessible cache
    const clientData = await session.fetchClient(ctx.from.id);

    if (clientData != null) {
      await sendAccessibleNotify(ctx.from.id);
    } else {
      await ctx.conversation.enter("inputPhoneNumber");
    }
  }
});

bot.on("message", async (ctx) => {
    const msg = ctx.msg;
    if (msg.text && msg.text.startsWith("/")) { return; }
    const mngrID = await storage.getManagerTgID();

    if (msg.from.id != mngrID) {
      await ctx.api.forwardMessage(mngrID, ctx.from.id, msg.message_id);
    } else {
      const reply_msg = msg.reply_to_message;
      if (
        reply_msg
        && reply_msg.forward_origin
        && reply_msg.forward_origin.type == "user"
      ) {
        const me = (await ctx.api.getMe());
        if (
          reply_msg.from.id == me.id
          && reply_msg.forward_origin.sender_user.id != me.id
        ) {
          await ctx.api.copyMessage(
            reply_msg.forward_origin.sender_user.id,
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
    "https://i.imgur.com/5QnS7NR.jpg",
    {
      caption: await StaticUtils.getText("start"),
      reply_markup: new InlineKeyboard().webApp("Заказать", config.get("bot.webAppURL"))
    }
  );
  } catch (error) {
    console.error(`Error in sending accessible notification to ${clientTgID}:`, error);
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
