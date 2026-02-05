import { Bot, InlineKeyboard, Keyboard } from 'grammy';

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

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = process.env.API_URL || 'https://backend-production-5ee9.up.railway.app';

// WebApp URL - perkup.com.ua
const WEB_APP_URL = 'https://perkup.com.ua';

// Owner Telegram ID
const OWNER_ID = 7363233852;

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
      body: JSON.stringify({ adminTelegramId, code: code.toUpperCase() }),
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
 * Get User keyboard (basic - just WebApp)
 */
function getUserKeyboard(): Keyboard {
  return new Keyboard()
    .webApp('☕️ Відкрити PerkUp', WEB_APP_URL)
    .resized();
}

/**
 * Get Admin keyboard (WebApp + verify code)
 */
function getAdminKeyboard(): Keyboard {
  return new Keyboard()
    .webApp('☕️ Відкрити PerkUp', WEB_APP_URL)
    .row()
    .text('🔍 Перевірити код')
    .resized();
}

/**
 * Get Owner keyboard (WebApp + all management buttons)
 */
function getOwnerKeyboard(): Keyboard {
  return new Keyboard()
    .webApp('☕️ Відкрити PerkUp', WEB_APP_URL)
    .row()
    .text('🔍 Перевірити код')
    .text('📊 Статистика за 24г')
    .row()
    .text('👥 Керування адмінами')
    .resized();
}

// Start command
bot.command('start', async (ctx) => {
  const user = ctx.from;
  const userId = user?.id;
  const firstName = user?.first_name || 'друже';

  if (!userId) return;

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
  await ctx.reply(
    `Привіт, ${firstName}! 👋\n\n` +
      `Ласкаво просимо до *PerkUp* — твого помічника у світі кави! ☕\n\n` +
      `Тут ти можеш:\n` +
      `• Обрати найближчу кав'ярню\n` +
      `• Зробити замовлення онлайн\n` +
      `• Накопичувати бонуси\n` +
      `• Крутити Колесо Фортуни 🎡\n\n` +
      `📍 *Надішли Live Location* (транслювати геолокацію) — і ми автоматично повідомимо, коли будеш поруч з кав'ярнею!\n\n` +
      `Натисни кнопку нижче, щоб почати! 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: getUserKeyboard(),
    }
  );
});

// Help command
bot.command('help', async (ctx) => {
  const userId = ctx.from?.id;

  let keyboard = getUserKeyboard();
  if (userId) {
    const { isAdmin, isOwner } = await getUserRole(userId);
    keyboard = isOwner ? getOwnerKeyboard() : isAdmin ? getAdminKeyboard() : getUserKeyboard();
  }

  await ctx.reply(
    `*Як користуватися PerkUp:*\n\n` +
      `1️⃣ Натисни кнопку "Відкрити PerkUp"\n` +
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
    await ctx.reply('🏠 Головне меню', { reply_markup: getOwnerKeyboard() });
    return;
  }

  // Handle "Verify Code" button
  if (text === '🔍 Перевірити код' && (isAdmin || isOwner)) {
    waitingForCode.add(userId);
    waitingForAdminId.delete(userId);
    await ctx.reply(
      '🔍 Введи код купону у форматі *XX-00000* (наприклад, CO-77341):',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Handle "Stats" button (Owner only)
  if (text === '📊 Статистика за 24г' && isOwner) {
    waitingForCode.delete(userId);
    waitingForAdminId.delete(userId);

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
    return;
  }

  // Handle "Admin Management" button (Owner only)
  if (text === '👥 Керування адмінами' && isOwner) {
    waitingForCode.delete(userId);
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

    // Validate code format (XX-00000)
    const codeRegex = /^[A-Za-z]{2}-\d{5}$/;
    if (!codeRegex.test(text)) {
      await ctx.reply(
        '❌ Невірний формат коду.\n\nОчікується: *XX-00000* (наприклад, CO-77341)',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const result = await verifyCode(userId, text);
    const keyboard = isOwner ? getOwnerKeyboard() : getAdminKeyboard();

    if (result.success) {
      await ctx.reply(
        `✅ *Код підтверджено!*\n\n` +
          `Клієнт: ${result.user?.firstName || 'Невідомий'}\n` +
          `Код: \`${text.toUpperCase()}\`\n\n` +
          `💰 Списано 100 балів.\n` +
          `☕ *Видайте напій до 100 грн!*`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    } else {
      await ctx.reply(`❌ ${result.message}`, { reply_markup: keyboard });
    }
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
  const keyboard = isOwner ? getOwnerKeyboard() : isAdmin ? getAdminKeyboard() : getUserKeyboard();

  await ctx.reply(
    `Щоб зробити замовлення, скористайся нашим додатком! 👇\n\n` +
      `📍 Або надішли свою геолокацію, щоб дізнатися відстань до найближчої кав'ярні.`,
    { reply_markup: keyboard }
  );
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
