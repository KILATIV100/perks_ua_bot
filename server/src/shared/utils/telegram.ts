/**
 * Telegram Bot API utilities
 */

const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Send a Markdown message to a Telegram user via the Bot API.
 * Fails silently — never throws, so callers don't need try/catch.
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch {
    // silent — Telegram delivery is best-effort
  }
}
