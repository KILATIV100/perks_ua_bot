const BOT_TOKEN = process.env.BOT_TOKEN;
export const OWNER_TELEGRAM_ID = '7363233852';

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
): Promise<void> {
  if (!BOT_TOKEN) return;

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    };
    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // silent
  }
}

export async function notifyOwnerNewUser(firstName: string | undefined, telegramId: string): Promise<void> {
  const message = `🆕 *Новий клієнт у системі!*\n\n` +
    `👤 Ім'я: ${firstName || 'Невідомо'}\n` +
    `🆔 ID: \`${telegramId}\``;

  sendTelegramMessage(OWNER_TELEGRAM_ID, message).catch(() => {});
}
