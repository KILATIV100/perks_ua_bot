import { Bot, InlineKeyboard } from 'grammy';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;

// WebApp URL - perkup.com.ua
const WEB_APP_URL = 'https://perkup.com.ua';

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Bot(BOT_TOKEN);

// Start command - greet user and show Mini App button
bot.command('start', async (ctx) => {
  const user = ctx.from;
  const firstName = user?.first_name || 'друже';

  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  await ctx.reply(
    `Привіт, ${firstName}! 👋\n\n` +
      `Ласкаво просимо до *PerkUp* — твого помічника у світі кави! ☕\n\n` +
      `Тут ти можеш:\n` +
      `• Обрати найближчу кав'ярню\n` +
      `• Зробити замовлення онлайн\n` +
      `• Накопичувати бонуси\n\n` +
      `Натисни кнопку нижче, щоб почати! 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Help command
bot.command('help', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  await ctx.reply(
    `*Як користуватися PerkUp:*\n\n` +
      `1️⃣ Натисни кнопку "Відкрити PerkUp"\n` +
      `2️⃣ Обери локацію кав'ярні\n` +
      `3️⃣ Переглянь меню та зроби замовлення\n` +
      `4️⃣ Отримай сповіщення, коли замовлення готове\n\n` +
      `Якщо є питання — пиши нам! 💬`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Handle any text message
bot.on('message:text', async (ctx) => {
  const keyboard = new InlineKeyboard().webApp(
    '☕ Відкрити PerkUp',
    WEB_APP_URL
  );

  await ctx.reply(
    `Щоб зробити замовлення, скористайся нашим додатком! 👇`,
    {
      reply_markup: keyboard,
    }
  );
});

// Error handling
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Start bot
console.log('🤖 Starting PerkUp bot...');
bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} is running!`);
  },
});
