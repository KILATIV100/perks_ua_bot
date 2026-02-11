/**
 * Orders Module — HTTP Routes
 *
 * POST  /api/orders              — Place an order
 * GET   /api/orders?telegramId=  — User's recent orders
 * GET   /api/orders/:id          — Order details
 * PATCH /api/orders/:id/status   — Update order status (admin)
 */

// This module re-exports from the existing routes file to keep backward
// compatibility while the codebase transitions to the modular structure.
// The full order logic lives in server/src/routes/orders.ts.

export { orderRoutes } from '../../routes/orders.js';
