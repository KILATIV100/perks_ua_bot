# PerkUp - Railway Deployment Guide

## Архітектура

Проєкт складається з трьох сервісів:

1. **Server** (`/server`) - Backend API на Fastify + Prisma
2. **Bot** (`/bot`) - Telegram бот на grammY
3. **Client** (`/client`) - React Mini App

## Деплой на Railway

### Крок 1: Створення проєкту

1. Увійдіть на [railway.app](https://railway.app)
2. Створіть новий проєкт: `New Project > Empty Project`

### Крок 2: Додавання PostgreSQL

1. В проєкті натисніть `+ New > Database > PostgreSQL`
2. Дочекайтесь створення бази даних
3. Скопіюйте `DATABASE_URL` з вкладки Variables

### Крок 3: Деплой Server

1. `+ New > GitHub Repo > Виберіть репозиторій`
2. В налаштуваннях сервісу:
   - **Root Directory**: `server`
   - **Variables**:
     - `DATABASE_URL` - з PostgreSQL
     - `PORT` - автоматично Railway
3. Отримайте URL сервера після деплою

### Крок 4: Деплой Client

1. `+ New > GitHub Repo > Виберіть той самий репозиторій`
2. В налаштуваннях сервісу:
   - **Root Directory**: `client`
   - **Variables**:
     - `VITE_API_URL` - URL вашого сервера (з кроку 3)
3. Отримайте URL клієнта після деплою

### Крок 5: Деплой Bot

1. `+ New > GitHub Repo > Виберіть той самий репозиторій`
2. В налаштуваннях сервісу:
   - **Root Directory**: `bot`
   - **Variables**:
     - `BOT_TOKEN` - токен від @BotFather
     - `MINI_APP_URL` - URL клієнта (з кроку 4)

## Змінні середовища

### Server
```
DATABASE_URL=postgresql://...
PORT=3000
NODE_ENV=production
```

### Bot
```
BOT_TOKEN=your_bot_token
MINI_APP_URL=https://your-client.railway.app
```

### Client
```
VITE_API_URL=https://your-server.railway.app
```

## Команди для локального тестування (опціонально)

```bash
# Встановлення залежностей
npm run install:all

# Генерація Prisma клієнта
npm run db:generate

# Застосування схеми до БД
npm run db:push

# Заповнення тестовими даними
npm run db:seed
```

## Налаштування Telegram Mini App

1. Відкрийте @BotFather
2. Виберіть вашого бота
3. `Bot Settings > Menu Button > Configure menu button`
4. Встановіть URL клієнта як Web App URL

## Структура проєкту

```
perkup/
├── server/           # Backend API
│   ├── src/
│   │   ├── index.ts
│   │   └── routes/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── railway.toml
├── bot/              # Telegram Bot
│   ├── src/
│   │   └── index.ts
│   └── railway.toml
├── client/           # React Mini App
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/
│   └── railway.toml
└── DEPLOY.md
```
