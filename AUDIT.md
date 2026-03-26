# Технічний аудит PerkUp — статус проєкту (оновлено 2026-03-13)

## Короткий висновок

Проєкт уже має сильний фундамент (модульний backend, JWT-авторизація, лояльність, ігри, адмін-роути, базова інтеграція з Poster), але зараз перебуває у **гібридному стані**: частина фіч працює як production-ready, частина — як прототип або "заготовка".

Найбільші продуктові ризики зараз:

1. Немає завершеного end-to-end флоу онлайн-оплати → Poster → фіскалізація/каса/повернення.
2. Архітектура Poster розрахована на **один токен акаунта** і не підтримує повноцінно "окремий Poster акаунт на кожну локацію".
3. Coffee DNA у фронті/боті реалізовано як placeholder (без реального API-движка).
4. Perky Jump технічно реалізований, але стабільність залежить від синхронізації salt/env і клієнтського флоу.
5. Лояльність наразі частково залежить від подій Poster (transaction webhook/polling), тому без повної інтеграції покриття мережі неповне.

---

## 1) Що зараз працює

### Backend/архітектура
- Піднятий modular monolith на Fastify, зареєстровані модулі auth/loyalty/orders/games/poster/referral/admin тощо.  
- Є JWT auth + refresh, маршрути API структуровані за доменами.  
- Є модульна інтеграція Poster (`poster.service`, webhook routes, sync menu, analytics, transaction polling).  
- Є модуль games з `submit-score` (anti-cheat перевірка hash/timestamp/реалістичності + денні ліміти).

### Продуктові фічі
- Локації, меню, кошик, створення замовлень (PENDING + адміністраторські нотифікації).
- Колесо фортуни + redemption коди + points logs.
- TicTacToe, Perky Jump 3D UI, Daily limits API.

---

## 2) Що не працює або працює частково (відносно ваших 6 пунктів)

### 2.1 «Немає інтеграції з Poster»
**Факт:** інтеграція є, але **часткова**.

Що є:
- Sync меню/категорій, webhook обробка `product/dish/incoming_order/transaction`, polling транзакцій, створення incoming order після підтвердженої оплати.

Що не закрито end-to-end:
- Немає вбудованого платіжного шлюзу в основному checkout-флоу.
- `payment-verified` — технічний webhook-місток, а не готовий прод-флоу з провайдером.
- Refund-процес позначений TODO.

**Висновок:** інтеграція з Poster існує, але ще не завершена як «бойовий» наскрізний процес.

### 2.2 «Кожна локація має окремі меню/інтеграції (різні Poster акаунти), окрім Mark Mall»
**Факт:** поточна архітектура цього не покриває повністю.

Що зараз:
- Використовується один `POSTER_ACCESS_TOKEN` на весь сервер.
- У `Location` є `posterSpotId`, але немає сутності "Poster account credentials per location".
- Для Mark Mall у фронті зашитий статичний `MARK_MALL_MENU` і view-only логіка.

**Висновок:** у вас правильне спостереження — multi-account Poster не реалізований системно; Mark Mall справді винесений у статичний сценарій.

### 2.3 «Не реалізовано онлайн-замовлення через Poster (синхронізація чеків/оплат/каси)»
**Факт:** реалізовано лише частину ланцюга.

Є:
- Створення локального order.
- Endpoint `/api/webhooks/payment-verified`, який після зовнішнього підтвердження оплати створює incoming order в Poster.
- Обробка `incoming_order` webhook (accept/close/reject).

Немає:
- Єдиного платіжного orchestration у checkout (init payment → callback verify/signature → payment-verified).
- Рефандів при `incoming_order=reject`.
- Гарантованої двосторонньої звірки оплата/чек/статус для всіх сценаріїв.

### 2.4 «Не працює DNA»
**Факт:** підтверджено.

- У фронті `CoffeeDna` повертає заглушку (`totalOrders: 0`, без API-запиту).
- У боті команда `/dna` теж має `TODO` і віддає інформаційний текст.
- У Prisma є `DnaProfile`, тобто модель у БД передбачена, але бізнес-логіка не доведена до інтегрованого API.

### 2.5 «Не працює перкі джамп»
**Факт:** логіка на бекенді є, але можливі причини «не працює» в проді:

- Salt mismatch між `VITE_GAME_SALT` (клієнт) і `GAME_SCORE_SECRET_SALT` (сервер) → `InvalidHash`.
- Немає явного UX-повідомлення при відхиленні score (частина помилок замовчується у фронті).
- Можлива плутанина legacy endpoint vs новий `submit-score`.

**Висновок:** фіча не «відсутня», але може бути нестабільною/непрозорою для користувача через середовищні та UX-проблеми.

### 2.6 «Єдина система лояльності окремо від Poster»
**Факт:** частково вже так, але не повністю стандартизовано по мережі.

- Поточна loyalty живе в PerkUp БД (points, spin, redeem, logs).
- Але purchase-based бонуси покладаються на події Poster (`transaction` webhooks/polling) і мапінг клієнта.

**Висновок:** ядро єдиної лояльності вже є у PerkUp, однак треба доробити незалежний від Poster capture транзакцій або уніфікований ingestion-шар для всіх локацій/кас.

---

## 3) План виправлення (пріоритети)

## P0 (критично, 1-2 спринти)
1. **Завершити online payment orchestration**:
   - Стандартний payment service (create payment, callback verify, idempotency key).
   - Після verify автоматично викликати `createIncomingOrderForPaidOrder`.
   - Реалізувати refund flow на reject/cancel.

2. **Прибрати технічний борг по подвійних webhook-ендпоінтах Poster**:
   - Залишити один канонічний endpoint (`/api/webhooks/poster`) і прибрати дубль логіки.

3. **Perky Jump observability**:
   - Логувати/повертати клієнту чіткі причини `InvalidHash`, `ExpiredScore`, `UnrealisticScore`.
   - Додати health-check endpoint конфігурації game salt (без розкриття секрету, лише статус matched/missing).

## P1 (високий, 2-4 спринти)
4. **Multi-account Poster per location**:
   - Додати таблицю `LocationPosterConfig` (api token / account id / spot mapping / active flag).
   - Винести Poster client factory: вибір credentials по location.
   - Окремі синки меню по локації.

5. **DNA MVP**:
   - API: `GET /api/users/:id/dna` + background recompute job.
   - Метрики: top drink, time preference, sugar-free ratio, top location.
   - Відмова від заглушок у фронті/боті.

6. **Уніфікація лояльності незалежно від каси**:
   - Ввести шар `PurchaseEvent` (джерела: Poster webhook, manual import, external POS connector).
   - Нарахування балів тільки через один service-алгоритм.

## P2 (середній)
7. **Mark Mall strategy**:
   - Або підключити окремий Poster акаунт і прибрати статичне меню,
   - або залишити view-only, але явно відобразити це в адмінці та операційному регламенті.

8. **Операційна аналітика**:
   - Дашборд по конверсії: created order → paid → sent to Poster → accepted → ready.

---

## 4) Практичні шляхи вирішення саме ваших пунктів

1. **Poster інтеграція** → не переробляти з нуля, а добудувати payment/refund/idempotency навколо існуючого `PosterService`.
2. **Різні акаунти на локаціях** → відмовитись від глобального `POSTER_ACCESS_TOKEN`, перейти на `location-scoped credentials`.
3. **Онлайн-замовлення/чеки/каса** → стандартизувати state machine замовлення + webhooks провайдера + webhook Poster.
4. **DNA** → запустити MVP на основі вже наявної таблиці `DnaProfile` і історії `orders/order_items`.
5. **Perky Jump** → вирівняти env (salt), додати прозорі повідомлення в UI, прибрати silent fail.
6. **Єдина лояльність по мережі** → події покупок централізовано збирати в PerkUp, Poster зробити лише одним із джерел подій, а не "джерелом істини".

---

## 5) Рекомендована дорожня карта (8 тижнів)

- **Тиждень 1-2:** Payment orchestration + idempotency + refund skeleton.
- **Тиждень 3-4:** Multi-location Poster credentials + меню sync per location.
- **Тиждень 5:** DNA API MVP + інтеграція фронт/бот.
- **Тиждень 6:** Perky Jump hardening + UX помилок + аналітика.
- **Тиждень 7-8:** Loyalty ingestion layer + backfill і звірка балів по історичних покупках.

