import { createServer, type Server as HttpServer } from 'node:http';
import { Bot, InlineKeyboard, Keyboard, webhookCallback } from 'grammy';

// API Response Types
interface UserRoleResponse {
  role: string;
  isAdmin: boolean;
  isOwner: boolean;
}

interface AdminListResponse {
  admins: Array<{
    telegramId: string;
    firstName: string | null;
    username: string | null;
    role: string;
  }>;
}

interface SetRoleResponse {
  success?: boolean;
  error?: string;
}

interface VerifyCodeResponse {
  success?: boolean;
  message?: string;
  user?: {
    firstName: string | null;
  };
}

interface StatsResponse {
  period: string;
  newUsers: number;
  spins: number;
  freeDrinks: number;
  orders: number;
  totalUsers: number;
  totalPointsInCirculation: number;
  generatedAt: string;
}

interface ExportResponse {
  exportedAt: string;
  totalUsers: number;
  totalPoints: number;
  totalSpins: number;
  users: Array<{
    telegramId: string;
    username: string | null;
    firstName: string | null;
    points: number;
    role: string;
  }>;
}

// Response for getting all users for broadcast
interface AllUsersResponse {
  users: Array<{
    telegramId: string;
    firstName: string | null;
  }>;
  total: number;
}

// Response for adding points
interface AddPointsResponse {
  success: boolean;
  newBalance: number;
  added: number;
}

interface OrderStatusUpdateResponse {
  success: boolean;
  order?: {
    id: string;
    status: string;
    userTelegramId?: string;
  };
  error?: string;
}

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = process.env.API_URL || 'https://backend-production-5ee9.up.railway.app';
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || `/telegram/webhook/${BOT_TOKEN}`;
const PORT = Number(process.env.PORT) || 3001;

// WebApp URL - perkup.com.ua
const WEB_APP_URL = 'https://perkup.com.ua';

// Owner Telegram ID (from env or fallback)
const OWNER_ID = Number(process.env.OWNER_ID) || 7363233852;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Bot(BOT_TOKEN);

// PerkUp locations in Brovary
const LOCATIONS = [
  { name: 'Mark Mall', lat: 50.51485367479439, lng: 30.78219892858682 },
  { name: 'Парк "Приозерний"', lat: 50.50128659421246, lng: 30.754029265863245 },
  { name: 'ЖК "Лісовий квартал"', lat: 50.51758555255138, lng: 30.783235338021694 },
];

// Notification radius in meters (500m)
const NOTIFICATION_RADIUS = 500;

// Store last notification time per user to avoid spam (userId -> timestamp)
const lastNotificationTime = new Map<number, number>();

// Minimum time between notifications (15 minutes)
const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;

// Store users waiting for admin ID input
const waitingForAdminId = new Set<number>();

// Store users waiting for code verification
const waitingForCode = new Set<number>();

// Store users waiting for broadcast message input
const waitingForBroadcast = new Set<number>();

// Store owners waiting for grant-points input (format: <telegramId> <points>)
const waitingForGrantPoints = new Set<number>();

// Store owners waiting to send audio file for radio
const waitingForRadioTrack = new Set<number>();

// Random notification messages
const PROXIMITY_MESSAGES = [
  "Відчуваєш цей аромат? ☕️ Ти всього в 5 хвилинах від ідеального капучино. Заходь!",
  "Бро, ти сьогодні якийсь занадто тверезий... Може, час на подвійний еспресо? Ми поруч! 😉",
  "Твоя денна норма кави сама себе не вип'є. Завітай у PerkUp, ми за 500 метрів від тебе!",
  "Ого, яка зустріч! Ти якраз поблизу нашої точки. Заходь, крутнеш колесо — може, кава буде зі знижкою? 🎡",
  "Твої бали сумують без тебе... Заходь на Mark Mall, ми вже розігріли кавомашину!",
];

/**
 * Check user role via API
 */
async function getUserRole(telegramId: number): Promise<UserRoleResponse> {
  try {
    const response = await fetch(`${API_URL}/api/admin/check-role?telegramId=${telegramId}`);
    if (response.ok) {
      const data = (await response.json()) as UserRoleResponse;
      return data;
    }
  } catch (error) {
    console.error('[API] Failed to check role:', error);
  }
  return { role: 'USER', isAdmin: false, isOwner: false };
}

/**
 * Get admin list via API
 */
async function getAdminList(requesterId: number): Promise<Array<{ telegramId: string; firstName: string | null; username: string | null; role: string }>> {
  try {
    const response = await fetch(`${API_URL}/api/admin/list?requesterId=${requesterId}`);
    if (response.ok) {
      const data = (await response.json()) as AdminListResponse;
      return data.admins || [];
    }
  } catch (error) {
    console.error('[API] Failed to get admin list:', error);
  }
  return [];
}

/**
 * Set user role via API
 */
async function setUserRole(requesterId: number, targetTelegramId: number, newRole: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${API_URL}/api/admin/set-role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId, targetTelegramId, newRole }),
    });
    const data = (await response.json()) as SetRoleResponse;
    if (response.ok) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Unknown error' };
  } catch (error) {
    console.error('[API] Failed to set role:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Verify redemption code via API
 */
async function verifyCode(adminTelegramId: number, code: string): Promise<{ success: boolean; message: string; user?: { firstName: string | null } }> {
  try {
    const response = await fetch(`${API_URL}/api/admin/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminTelegramId, code: code.trim() }),
    });
    const data = (await response.json()) as VerifyCodeResponse;
    if (response.ok) {
      return { success: true, message: data.message || 'Код підтверджено', user: data.user };
    }
    return { success: false, message: data.message || 'Помилка перевірки коду' };
  } catch (error) {
    console.error('[API] Failed to verify code:', error);
    return { success: false, message: 'Помилка з\'єднання з сервером' };
  }
}

/**
 * Get 24h stats via API (Owner only)
 */
async function getStats(requesterId: number): Promise<StatsResponse | null> {
  try {
    const response = await fetch(`${API_URL}/api/admin/stats?requesterId=${requesterId}`);
    if (response.ok) {
      const data = (await response.json()) as StatsResponse;
      return data;
    }
  } catch (error) {
    console.error('[API] Failed to get stats:', error);
  }
  return null;
}

/**
 * Export users via API (Owner only)
 */
async function getExportUsers(requesterId: number): Promise<ExportResponse | null> {
  try {
    const response = await fetch(`${API_URL}/api/admin/export-users?requesterId=${requesterId}`);
    if (response.ok) {
      const data = (await response.json()) as ExportResponse;
      return data;
    }
  } catch (error) {
    console.error('[API] Failed to export users:', error);
  }
  return null;
}

/**
 * Get all users for broadcast (Owner only)
 */
async function getAllUsersForBroadcast(requesterId: number): Promise<AllUsersResponse | null> {
  try {
    const response = await fetch(`${API_URL}/api/admin/all-users?requesterId=${requesterId}`);
    if (response.ok) {
      const data = (await response.json()) as AllUsersResponse;
      return data;
    }
  } catch (error) {
    console.error('[API] Failed to get all users:', error);
  }
  return null;
}

/**
 * Add track to radio via API (Owner)
 */
async function addRadioTrack(
  telegramId: number,
  title: string,
  artist: string,
  telegramFileId: string,
): Promise<{ success: boolean; track?: { id: string; title: string } } | null> {
  try {
    const response = await fetch(`${API_URL}/api/radio/tracks/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: String(telegramId), title, artist, telegramFileId }),
    });

    if (response.ok) {
      return (await response.json()) as { success: boolean; track: { id: string; title: string } };
    }
  } catch (error) {
    console.error('[API] Failed to add radio track:', error);
  }
  return null;
}

/**
 * Add points (Owner): to self or target telegramId
 */
async function addPoints(requesterTelegramId: number, points: number, targetTelegramId?: number): Promise<AddPointsResponse | null> {
  try {
    const payload: Record<string, unknown> = { telegramId: String(requesterTelegramId), points };
    if (targetTelegramId) {
      payload.targetTelegramId = String(targetTelegramId);
    }

    const response = await fetch(`${API_URL}/api/admin/add-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return (await response.json()) as AddPointsResponse;
    }

    const errorText = await response.text();
    console.error(`[API] Add points error: ${errorText}`);
  } catch (error) {
    console.error('[API] Failed to add points:', error);
  }

  return null;
}

/**
 * Send broadcast message to all users
 */
async function sendBroadcast(bot: Bot, message: string, requesterId: number): Promise<{ sent: number; failed: number }> {
  const usersData = await getAllUsersForBroadcast(requesterId);

  if (!usersData || usersData.users.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const user of usersData.users) {
    try {
      await bot.api.sendMessage(Number(user.telegramId), message, { parse_mode: 'Markdown' });
      sent++;
      // Small delay to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      // User probably blocked the bot
      console.log(`[Broadcast] Failed to send to ${user.telegramId}:`, error);
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function findNearestLocation(userLat: number, userLng: number): { name: string; distance: number } | null {
  let nearest: { name: string; distance: number } | null = null;
  for (const location of LOCATIONS) {
    const distance = calculateDistance(userLat, userLng, location.lat, location.lng);
    if (!nearest || distance < nearest.distance) {
      nearest = { name: location.name, distance };
    }
  }
  return nearest;
}

function getRandomMessage(): string {
  return PROXIMITY_MESSAGES[Math.floor(Math.random() * PROXIMITY_MESSAGES.length)];
}

function canNotifyUser(userId: number): boolean {
  const lastTime = lastNotificationTime.get(userId);
  if (!lastTime) return true;
  return Date.now() - lastTime >= NOTIFICATION_COOLDOWN_MS;
}

function markUserNotified(userId: number): void {
  lastNotificationTime.set(userId, Date.now());
}

/**
 * Sync user via API (with optional referrer)
 */
async function syncUserWithReferral(telegramId: number, firstName: string | undefined, username: string | undefined, referrerId?: string): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      telegramId: String(telegramId),
      firstName,
      username,
    };
    if (referrerId) {
      body.referrerId = referrerId;
    }

    await fetch(`${API_URL}/api/user/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log(`[Referral] Synced user ${telegramId} with referrer ${referrerId || 'none'}`);
  } catch (error) {
    console.error('[Referral] Failed to sync user:', error);
  }
}

/**
 * Get User keyboard with invite button
 */
function getUserKeyboard(): Keyboard {
  return new Keyboard()
    .text('🤝 Запросити друга')
    .resized();
}

/**
 * Get Admin keyboard (verify code only, WebApp via Menu Button)
 */
function getAdminKeyboard(): Keyboard {
  return new Keyboard()
    .text('🔍 Перевірити код')
    .resized();
}

/**
 * Get Owner keyboard (all management buttons, WebApp via Menu Button)
 */
function getOwnerKeyboard(): Keyboard {
  return new Keyboard()
    .text('🔍 Перевірити код')
    .text('💰 +100 балів')
    .text('🎯 Нарахувати іншому')
    .row()
    .text('📊 Статистика за 24г')
    .text('📣 Розсилка')
    .row()
    .text('👥 Керування адмінами')
    .text('🎵 Додати трек')
    .resized();
}

/**
 * Get keyboard for broadcast input (with cancel button)
 */
function getBroadcastKeyboard(): Keyboard {
  return new Keyboard()
    .text('⬅️ Скасувати')
    .resized();
}

/**
 * Get keyboard for code verification input (with cancel button)
 */
function getCodeVerificationKeyboard(): Keyboard {
  return new Keyboard()
    .text('⬅️ Скасувати')
    .resized();
}

// Start command (supports deep link referral: /start ref{TELEGRAM_ID})
bot.command('start', async (ctx) => {
  const user = ctx.from;
  const userId = user?.id;
  const firstName = user?.first_name || 'друже';

  if (!userId) return;

  // Parse referral parameter from deep link (format: ref_ID or legacy ref123456)
  const startParam = ctx.match; // grammY extracts the payload after /start
  let referrerId: string | undefined;
  if (startParam && typeof startParam === 'string') {
    // New format: ref_<userId>
    const refNewMatch = startParam.match(/^ref_(.+)$/);
    // Legacy format: ref<telegramId>
    const refLegacyMatch = startParam.match(/^ref(\d+)$/);

    if (refNewMatch) {
      referrerId = refNewMatch[1];
    } else if (refLegacyMatch) {
      referrerId = refLegacyMatch[1];
    }

    // Don't allow self-referral
    if (referrerId && (referrerId === String(userId))) {
      referrerId = undefined;
    }
  }

  // If referral param present, sync user with referrer immediately
  if (referrerId) {
    console.log(`[Referral] User ${userId} arrived via referral from ${referrerId}`);
    syncUserWithReferral(userId, user?.first_name, user?.username, referrerId);
  }

  // Check user role
  const { isAdmin, isOwner } = await getUserRole(userId);

  if (isOwner) {
    await ctx.reply(
      `Привіт, *${firstName}*! 👑\n\n` +
        `Ласкаво просимо до *PerkUp*!\n\n` +
        `Ти власник — використовуй меню нижче для керування.`,
      {
        parse_mode: 'Markdown',
        reply_markup: getOwnerKeyboard(),
      }
    );
    return;
  }

  if (isAdmin) {
    await ctx.reply(
      `Привіт, *${firstName}*! 🛡\n\n` +
        `Ласкаво просимо до *PerkUp*!\n\n` +
        `Ти адміністратор — використовуй кнопку нижче для перевірки кодів.`,
      {
        parse_mode: 'Markdown',
        reply_markup: getAdminKeyboard(),
      }
    );
    return;
  }

  // Regular user
  const referralNote = referrerId
    ? `\n🤝 Бро, ти прийшов від друга! Після першого крутка колеса ви обоє отримаєте бонуси.\n`
    : '';

  await ctx.reply(
    `Привіт, ${firstName}! 👋\n\n` +
      `Ласкаво просимо до *PerkUp* — твого помічника у світі кави! ☕\n${referralNote}\n` +
      `Тут ти можеш:\n` +
      `• Обрати найближчу кав'ярню\n` +
      `• Зробити замовлення онлайн\n` +
      `• Накопичувати бонуси\n` +
      `• Крутити Колесо Фортуни 🎡\n\n` +
      `📍 *Надішли Live Location* (транслювати геолокацію) — і ми автоматично повідомимо, коли будеш поруч з кав'ярнею!\n\n` +
      `Натисни кнопку *PerkUP* зліва від поля вводу, щоб почати! 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: getUserKeyboard(),
    }
  );
});

// Help command
bot.command('help', async (ctx) => {
  const userId = ctx.from?.id;

  let keyboard: Keyboard | undefined;
  if (userId) {
    const { isAdmin, isOwner } = await getUserRole(userId);
    keyboard = isOwner ? getOwnerKeyboard() : isAdmin ? getAdminKeyboard() : getUserKeyboard();
  }

  await ctx.reply(
    `*Як користуватися PerkUp:*\n\n` +
      `1️⃣ Натисни кнопку *PerkUP* зліва від поля вводу\n` +
      `2️⃣ Обери локацію кав'ярні\n` +
      `3️⃣ Переглянь меню та зроби замовлення\n` +
      `4️⃣ Отримай сповіщення, коли замовлення готове\n\n` +
      `🎡 *Колесо Фортуни:*\n` +
      `• Підійди до кав'ярні (до 50м)\n` +
      `• Крутни колесо раз на день\n` +
      `• Отримай 5, 10 або 15 балів!\n\n` +
      `📍 *Геолокація:*\n` +
      `• Надішли звичайну локацію — дізнаєшся відстань\n` +
      `• Надішли *Live Location* (транслювати) — отримуй сповіщення автоматично, коли будеш поруч!\n\n` +
      `Якщо є питання — пиши нам! 💬`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Stats command (Owner only)
bot.command('stats', async (ctx) => {
  const userId = ctx.from?.id;

  if (!userId) return;

  const { isOwner } = await getUserRole(userId);

  if (!isOwner) {
    await ctx.reply('❌ Ця команда доступна тільки для власника.');
    return;
  }

  const stats = await getStats(userId);

  if (!stats) {
    await ctx.reply('❌ Не вдалося отримати статистику. Спробуй пізніше.');
    return;
  }

  const generatedTime = new Date(stats.generatedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

  await ctx.reply(
    `📊 *Статистика за останні 24 години*\n\n` +
      `👥 Нових користувачів: *${stats.newUsers}*\n` +
      `🎡 Обертань колеса: *${stats.spins}*\n` +
      `☕ Безкоштовних напоїв: *${stats.freeDrinks}*\n\n` +
      `📈 *Загальна статистика:*\n` +
      `👤 Всього користувачів: *${stats.totalUsers}*\n` +
      `🪙 Балів в обігу: *${stats.totalPointsInCirculation}*\n\n` +
      `🕒 Згенеровано: ${generatedTime}`,
    { parse_mode: 'Markdown' }
  );
});

// Export command (Owner only)
bot.command('export', async (ctx) => {
  const userId = ctx.from?.id;

  if (!userId) return;

  const { isOwner } = await getUserRole(userId);

  if (!isOwner) {
    await ctx.reply('❌ Ця команда доступна тільки для власника.');
    return;
  }

  await ctx.reply('⏳ Експортую дані користувачів...');

  const exportData = await getExportUsers(userId);

  if (!exportData) {
    await ctx.reply('❌ Не вдалося експортувати дані. Спробуй пізніше.');
    return;
  }

  const exportedTime = new Date(exportData.exportedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

  // Create summary message
  let message = `📦 *Експорт користувачів*\n\n` +
    `👤 Всього: *${exportData.totalUsers}*\n` +
    `🪙 Балів в обігу: *${exportData.totalPoints}*\n` +
    `🎡 Всього обертань: *${exportData.totalSpins}*\n\n` +
    `🕒 Експортовано: ${exportedTime}\n\n`;

  // Add user list (limited to first 20 to avoid message limit)
  if (exportData.users.length > 0) {
    message += `*Топ-20 користувачів:*\n`;
    const topUsers = exportData.users
      .sort((a, b) => b.points - a.points)
      .slice(0, 20);

    topUsers.forEach((user, i) => {
      const name = user.firstName || user.username || `ID: ${user.telegramId}`;
      const roleIcon = user.role === 'OWNER' ? '👑' : user.role === 'ADMIN' ? '🛡' : '';
      message += `${i + 1}. ${roleIcon}${name}: *${user.points}* балів\n`;
    });
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Handle text messages (including keyboard buttons)
bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  const text = ctx.message.text;

  if (!userId) return;

  const { isAdmin, isOwner } = await getUserRole(userId);

  // Handle "Back" button (Owner only) - return to main menu
  if (text === '⬅️ Назад' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.delete(userId);
    waitingForGrantPoints.delete(userId);
    waitingForRadioTrack.delete(userId);
    await ctx.reply('🏠 Головне меню', { reply_markup: getOwnerKeyboard() });
    return;
  }

  // Handle "Invite Friend" button (all users)
  if (text === '🤝 Запросити друга') {
    // Use telegramId for referral links (the API resolves it)
    const refLink = `https://t.me/perkup_ua_bot?start=ref_${userId}`;
    await ctx.reply(
      `🤝 *Запроси друга до PerkUp!*\n\n` +
        `Твоє реферальне посилання:\n` +
        `\`${refLink}\`\n\n` +
        `Після першого обертання колеса другом:\n` +
        `• Ти отримаєш *+10 балів*\n\n` +
        `Надішли це посилання другу! 👇`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📨 Надіслати другу', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Приєднуйся до PerkUp — крути Колесо Фортуни та отримуй безкоштовну каву! ☕🎡')}` },
          ]],
        },
      }
    );
    return;
  }

  // Handle "Verify Code" button
  if (text === '🔍 Перевірити код' && (isAdmin || isOwner)) {
    waitingForCode.add(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.delete(userId);
    await ctx.reply(
      '🔍 Введи *4-значний код* купону (наприклад, 7341):',
      { parse_mode: 'Markdown', reply_markup: getCodeVerificationKeyboard() }
    );
    return;
  }

  // Handle "Stats" button (Owner only)
  if (text === '📊 Статистика за 24г' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.delete(userId);
    waitingForGrantPoints.delete(userId);
    waitingForRadioTrack.delete(userId);

    const stats = await getStats(userId);

    if (!stats) {
      await ctx.reply('❌ Не вдалося отримати статистику. Спробуй пізніше.');
      return;
    }

    const generatedTime = new Date(stats.generatedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

    await ctx.reply(
      `📊 *Статистика за останні 24 години*\n\n` +
        `👥 Нових користувачів: *${stats.newUsers}*\n` +
        `🎡 Обертань колеса: *${stats.spins}*\n` +
        `☕ Безкоштовних напоїв: *${stats.freeDrinks}*\n` +
        `📦 Замовлень: *${stats.orders || 0}*\n\n` +
        `📈 *Загальна статистика:*\n` +
        `👤 Всього користувачів: *${stats.totalUsers}*\n` +
        `🪙 Балів в обігу: *${stats.totalPointsInCirculation}*\n\n` +
        `🕒 Згенеровано: ${generatedTime}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Handle "+100 points" button (Owner only - God Mode)
  if (text === '💰 +100 балів' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.delete(userId);
    waitingForGrantPoints.delete(userId);
    waitingForRadioTrack.delete(userId);

    const result = await addPoints(userId, 100);

    if (result) {
      await ctx.reply(
        `✅ *Бали нараховано!*\n\n` +
          `💰 Додано: *+${result.added}* балів\n` +
          `🏦 Твій новий баланс: *${result.newBalance}* балів`,
        { parse_mode: 'Markdown', reply_markup: getOwnerKeyboard() }
      );
    } else {
      await ctx.reply('❌ Не вдалося нарахувати бали. Спробуй пізніше.', { reply_markup: getOwnerKeyboard() });
    }
    return;
  }

  // Handle "Grant points to another user" button (Owner only)
  if (text === '🎯 Нарахувати іншому' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.delete(userId);
    waitingForGrantPoints.add(userId);

    await ctx.reply(
      '🎯 *Нарахування балів іншому користувачу*\n\n' +
        'Введи у форматі: `telegramId сума`\n' +
        'Приклад: `123456789 100`\n\n' +
        'Натисни *⬅️ Скасувати* для виходу.',
      { parse_mode: 'Markdown', reply_markup: getCodeVerificationKeyboard() }
    );
    return;
  }

  // Handle "Add Track" button (Owner only)
  if (text === '🎵 Додати трек' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.delete(userId);
    waitingForGrantPoints.delete(userId);
    waitingForRadioTrack.delete(userId);
    waitingForRadioTrack.add(userId);

    await ctx.reply(
      '🎵 *Додавання треку до PerkUp Radio*\n\n' +
        'Надішли аудіофайл (MP3) або перешли аудіо з каналу.\n\n' +
        'Назва та виконавець підтягнуться автоматично з метаданих файлу.\n\n' +
        'Натисни *⬅️ Скасувати* для виходу.',
      { parse_mode: 'Markdown', reply_markup: getCodeVerificationKeyboard() }
    );
    return;
  }

  // Handle "Broadcast" button (Owner only)
  if (text === '📣 Розсилка' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);
    waitingForBroadcast.add(userId);
    waitingForGrantPoints.delete(userId);

    await ctx.reply(
      '📣 *Розсилка повідомлень*\n\n' +
        'Введи текст повідомлення, яке буде надіслано всім користувачам.\n\n' +
        '💡 Підтримується Markdown форматування:\n' +
        '`*жирний*` → *жирний*\n' +
        '`_курсив_` → _курсив_\n\n' +
        'Натисни *⬅️ Скасувати* щоб повернутися.',
      { parse_mode: 'Markdown', reply_markup: getBroadcastKeyboard() }
    );
    return;
  }

  // Handle "Cancel" button during code verification
  if (text === '⬅️ Скасувати' && waitingForCode.has(userId) && (isAdmin || isOwner)) {
    waitingForCode.delete(userId);
    const keyboard = isOwner ? getOwnerKeyboard() : getAdminKeyboard();
    await ctx.reply('🏠 Перевірку коду скасовано.', { reply_markup: keyboard });
    return;
  }

  // Handle "Cancel" button during grant points
  if (text === '⬅️ Скасувати' && waitingForGrantPoints.has(userId)) {
    waitingForGrantPoints.delete(userId);
    await ctx.reply('🏠 Нарахування скасовано.', { reply_markup: getOwnerKeyboard() });
    return;
  }

  // Handle "Cancel" button during radio track add
  if (text === '⬅️ Скасувати' && waitingForRadioTrack.has(userId)) {
    waitingForRadioTrack.delete(userId);
    await ctx.reply('🏠 Додавання треку скасовано.', { reply_markup: getOwnerKeyboard() });
    return;
  }

  if (text === '⬅️ Скасувати' && waitingForBroadcast.has(userId)) {
    waitingForBroadcast.delete(userId);
    await ctx.reply('🏠 Повернулися до головного меню.', { reply_markup: getOwnerKeyboard() });
    return;
  }

  // Handle broadcast message input (Owner only)
  if (waitingForBroadcast.has(userId) && isOwner) {
    waitingForBroadcast.delete(userId);

    await ctx.reply('⏳ Розпочинаю розсилку...', { reply_markup: { remove_keyboard: true } });

    const result = await sendBroadcast(bot, text, userId);

    await ctx.reply(
      `✅ *Розсилка завершена!*\n\n` +
        `📨 Отримали: *${result.sent}* користувачів\n` +
        `❌ Не доставлено: *${result.failed}* (заблокували бота)`,
      { parse_mode: 'Markdown', reply_markup: getOwnerKeyboard() }
    );
    return;
  }

  // Handle "Admin Management" button (Owner only)
  if (text === '👥 Керування адмінами' && isOwner) {
    waitingForCode.delete(userId);
    waitingForBroadcast.delete(userId);
    waitingForGrantPoints.delete(userId);
    waitingForRadioTrack.delete(userId);
    const admins = await getAdminList(userId);

    let message = '👥 *Керування адмінами*\n\n';

    const adminList = admins.filter(a => a.role === 'ADMIN');
    if (adminList.length === 0) {
      message += '_Адмінів поки немає_\n\n';
    } else {
      message += '*Поточні адміни:*\n';
      adminList.forEach((admin, i) => {
        const name = admin.firstName || admin.username || admin.telegramId;
        message += `${i + 1}. ${name} (ID: \`${admin.telegramId}\`)\n`;
      });
      message += '\n';
    }

    message += 'Щоб *додати* адміна, надішли ID користувача.\n';
    message += 'Щоб *видалити* адміна, напиши: `видалити ID`\n\n';
    message += 'Натисни *⬅️ Назад* щоб повернутися.';

    waitingForAdminId.add(userId);

    // Show admin management keyboard with back button
    const adminManagementKeyboard = new Keyboard()
      .text('⬅️ Назад')
      .resized();

    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: adminManagementKeyboard });
    return;
  }

  // Handle code verification input
  if (waitingForCode.has(userId) && (isAdmin || isOwner)) {
    waitingForCode.delete(userId);

    // Validate code format: 4-digit code
    const codeRegex = /^\d{4}$/;
    if (!codeRegex.test(text.trim())) {
      waitingForCode.add(userId);
      await ctx.reply(
        '❌ Невірний формат коду.\n\nОчікується: *4 цифри* (наприклад, 7341)',
        { parse_mode: 'Markdown', reply_markup: getCodeVerificationKeyboard() }
      );
      return;
    }

    const result = await verifyCode(userId, text.trim());
    const keyboard = isOwner ? getOwnerKeyboard() : getAdminKeyboard();

    if (result.success) {
      await ctx.reply('✅ Купон дійсний! Видайте напій', { reply_markup: keyboard });
    } else {
      await ctx.reply('❌ Код недійсний/прострочений', { reply_markup: keyboard });
    }
    return;
  }

  // Handle grant points input (Owner only)
  if (waitingForGrantPoints.has(userId) && isOwner) {
    const match = text.trim().match(/^(\d{5,})\s+(-?\d+)$/);
    if (!match) {
      await ctx.reply('❌ Формат невірний. Введи: `telegramId сума` (наприклад, `123456789 100`).', {
        parse_mode: 'Markdown',
        reply_markup: getCodeVerificationKeyboard(),
      });
      return;
    }

    const targetTelegramId = Number(match[1]);
    const points = Number(match[2]);

    if (!Number.isInteger(points) || points <= 0) {
      await ctx.reply('❌ Сума має бути цілим числом більше 0.', { reply_markup: getCodeVerificationKeyboard() });
      return;
    }

    const result = await addPoints(userId, points, targetTelegramId);
    if (!result) {
      await ctx.reply('❌ Не вдалося нарахувати бали. Перевір ID та спробуй ще раз.', {
        reply_markup: getCodeVerificationKeyboard(),
      });
      return;
    }

    waitingForGrantPoints.delete(userId);
    await ctx.reply(
      `✅ *Бали нараховано!*

` +
        `👤 Користувач: \`${targetTelegramId}\`
` +
        `💰 Додано: *+${result.added}* балів
` +
        `🏦 Новий баланс користувача: *${result.newBalance}* балів`,
      { parse_mode: 'Markdown', reply_markup: getOwnerKeyboard() }
    );
    return;
  }

  // Handle admin ID input (Owner only)
  if (waitingForAdminId.has(userId) && isOwner) {
    // Check for "delete" command
    const deleteMatch = text.match(/^видалити\s+(\d+)$/i);
    if (deleteMatch) {
      const targetId = parseInt(deleteMatch[1], 10);
      const result = await setUserRole(userId, targetId, 'USER');

      if (result.success) {
        waitingForAdminId.delete(userId);
        await ctx.reply(
          `✅ Адміна з ID \`${targetId}\` видалено.`,
          { parse_mode: 'Markdown', reply_markup: getOwnerKeyboard() }
        );
      } else {
        await ctx.reply(`❌ Помилка: ${result.error}`);
      }
      return;
    }

    // Try to add new admin
    const newAdminId = parseInt(text, 10);
    if (isNaN(newAdminId)) {
      await ctx.reply('❌ Невірний ID. Введи числовий Telegram ID користувача.');
      return;
    }

    const result = await setUserRole(userId, newAdminId, 'ADMIN');

    if (result.success) {
      waitingForAdminId.delete(userId);
      await ctx.reply(
        `✅ Користувача з ID \`${newAdminId}\` призначено адміном!`,
        { parse_mode: 'Markdown', reply_markup: getOwnerKeyboard() }
      );
    } else {
      await ctx.reply(`❌ Помилка: ${result.error}`);
    }
    return;
  }

  // Default response - show appropriate keyboard based on role
  const keyboard: Keyboard = isOwner
    ? getOwnerKeyboard()
    : isAdmin
      ? getAdminKeyboard()
      : getUserKeyboard();

  await ctx.reply(
    `Щоб зробити замовлення, натисни кнопку *PerkUP* зліва від поля вводу! 👇\n\n` +
      `📍 Або надішли свою геолокацію, щоб дізнатися відстань до найближчої кав'ярні.`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
});

// Handle audio messages (for radio track upload by Owner)
bot.on('message:audio', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Only process if owner is waiting to add a track
  if (!waitingForRadioTrack.has(userId)) return;

  const audio = ctx.message.audio;
  const fileId = audio.file_id;
  const title = audio.title || audio.file_name?.replace(/\.\w+$/, '') || 'Без назви';
  const artist = audio.performer || 'PerkUp Radio';

  waitingForRadioTrack.delete(userId);

  await ctx.reply('⏳ Додаю трек...');

  const result = await addRadioTrack(userId, title, artist, fileId);

  if (result?.success) {
    await ctx.reply(
      `✅ *Трек додано до PerkUp Radio!*\n\n` +
        `🎵 *${title}*\n` +
        `👤 ${artist}`,
      { parse_mode: 'Markdown', reply_markup: getOwnerKeyboard() }
    );
  } else {
    await ctx.reply('❌ Не вдалося додати трек. Спробуй ще раз.', { reply_markup: getOwnerKeyboard() });
  }
});

// Handle location messages
async function handleLocation(
  ctx: { from?: { id: number; first_name?: string }; reply: Function },
  latitude: number,
  longitude: number,
  isLiveLocation: boolean = false
): Promise<void> {
  const user = ctx.from;
  const userId = user?.id;
  const firstName = user?.first_name || 'друже';

  console.log(`[${isLiveLocation ? 'Live Location' : 'Location'}] User ${userId} (${firstName}): ${latitude}, ${longitude}`);

  const nearest = findNearestLocation(latitude, longitude);

  if (!nearest) {
    if (!isLiveLocation) {
      await ctx.reply('Не вдалося визначити найближчу локацію. Спробуй пізніше!');
    }
    return;
  }

  const keyboard = new InlineKeyboard().webApp('☕ Відкрити PerkUp', WEB_APP_URL);

  if (isLiveLocation) {
    if (nearest.distance <= NOTIFICATION_RADIUS && userId && canNotifyUser(userId)) {
      const randomMessage = getRandomMessage();
      markUserNotified(userId);

      await ctx.reply(
        `🔔 *Ти поруч з ${nearest.name}!*\n\n${randomMessage}`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    }
    return;
  }

  if (nearest.distance <= NOTIFICATION_RADIUS) {
    const randomMessage = getRandomMessage();
    await ctx.reply(
      `📍 *${nearest.name}* — ${Math.round(nearest.distance)} метрів\n\n${randomMessage}`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  } else if (nearest.distance <= 2000) {
    await ctx.reply(
      `📍 Найближча кав'ярня: *${nearest.name}*\nВідстань: ${Math.round(nearest.distance)} метрів\n\nПідійди ближче, щоб крутнути Колесо Фортуни! 🎡`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  } else {
    const distanceKm = (nearest.distance / 1000).toFixed(1);
    await ctx.reply(
      `📍 Найближча кав'ярня: *${nearest.name}*\nВідстань: ${distanceKm} км\n\nПоки що ти далековато, але ми чекаємо на тебе! ☕`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

bot.on('message:location', async (ctx) => {
  const { latitude, longitude, live_period } = ctx.message.location;
  const isLiveLocation = live_period !== undefined;
  await handleLocation(ctx, latitude, longitude, isLiveLocation);
});

bot.on('edited_message:location', async (ctx) => {
  const location = ctx.editedMessage?.location;
  if (!location) return;
  const { latitude, longitude } = location;
  await handleLocation(ctx, latitude, longitude, true);
});

// Handle callback queries (inline button presses)
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.answerCallbackQuery({ text: 'Помилка' });
    return;
  }

  const updateOrderStatus = async (orderId: string, status: 'PREPARING' | 'READY') => {
    const response = await fetch(`${API_URL}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminTelegramId: String(userId),
        status,
      }),
    });

    const responseData = (await response.json()) as OrderStatusUpdateResponse;
    return { ok: response.ok, data: responseData };
  };

  if (data.startsWith('order_accept:')) {
    const orderId = data.replace('order_accept:', '');

    try {
      const result = await updateOrderStatus(orderId, 'PREPARING');

      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: `❌ ${result.data.error || 'Помилка'}` });
        return;
      }

      await ctx.answerCallbackQuery({ text: '✅ Замовлення прийнято!' });
      const adminName = ctx.from?.first_name || `Admin ${userId}`;
      const originalText = ctx.callbackQuery.message?.text || '';

      await ctx.editMessageText(
        `${originalText}

✅ Прийнято в роботу — ${adminName}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '☕ Готово', callback_data: `order_ready:${orderId}` },
            ]],
          },
        }
      );
    } catch (error) {
      console.error('[Order Accept] Error:', error);
      await ctx.answerCallbackQuery({ text: '❌ Помилка з\'єднання' });
    }
    return;
  }

  if (data.startsWith('order_ready:')) {
    const orderId = data.replace('order_ready:', '');

    try {
      const result = await updateOrderStatus(orderId, 'READY');

      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: `❌ ${result.data.error || 'Помилка'}` });
        return;
      }

      await ctx.answerCallbackQuery({ text: '☕ Позначено як готове!' });
      const adminName = ctx.from?.first_name || `Admin ${userId}`;
      const originalText = ctx.callbackQuery.message?.text || '';

      await ctx.editMessageText(`${originalText}

☕ Готово до видачі — ${adminName}`);

      const userTelegramId = result.data.order?.userTelegramId;
      if (userTelegramId) {
        await bot.api.sendMessage(Number(userTelegramId), 'Твоя кава чекає на тебе! ☕️');
      }
    } catch (error) {
      console.error('[Order Ready] Error:', error);
      await ctx.answerCallbackQuery({ text: '❌ Помилка з\'єднання' });
    }
    return;
  }

  await ctx.answerCallbackQuery();
});

// Error handling
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Graceful shutdown
let webhookServer: HttpServer | null = null;

async function stopBot(signal: string): Promise<void> {
  console.log(`🛑 ${signal} received, stopping...`);

  if (webhookServer) {
    await new Promise<void>((resolve, reject) => {
      webhookServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  await bot.stop();
}

process.once('SIGINT', () => { void stopBot('SIGINT'); });
process.once('SIGTERM', () => { void stopBot('SIGTERM'); });

async function startBot() {
  console.log('🤖 Starting PerkUp bot...');

  if (process.env.NODE_ENV === 'production' && WEBHOOK_DOMAIN) {
    const webhookDomain = WEBHOOK_DOMAIN.replace(/\/$/, '');
    const webhookUrl = `${webhookDomain}${WEBHOOK_PATH}`;

    await bot.api.setWebhook(webhookUrl, { drop_pending_updates: true });
    console.log(`[Boot] Webhook set: ${webhookUrl}`);

    const callback = webhookCallback(bot, 'http');
    webhookServer = createServer((req, res) => {
      if (req.url === WEBHOOK_PATH) {
        void callback(req, res);
        return;
      }

      res.statusCode = 200;
      res.end('ok');
    });

    await new Promise<void>((resolve, reject) => {
      webhookServer?.listen(PORT, '0.0.0.0', () => resolve());
      webhookServer?.once('error', reject);
    });

    const me = await bot.api.getMe();
    console.log(`✅ Bot @${me.username} is running in webhook mode on port ${PORT}`);
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: true });
  console.log('[Boot] Webhook cleared, starting long polling...');

  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is running in polling mode`);
    },
    drop_pending_updates: true,
  });
}

startBot();
