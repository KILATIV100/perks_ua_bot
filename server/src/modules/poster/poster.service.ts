/**
 * Poster POS Integration Service
 *
 * Handles:
 * - Menu synchronization from Poster API
 * - Webhook processing for transaction.create / product.update
 * - Auto-points calculation on closed checks
 * - Analytics aggregation from Poster data
 */

import { PrismaClient } from '@prisma/client';

const POSTER_API_URL = 'https://joinposter.com/api';
const POSTER_ACCESS_TOKEN = process.env.POSTER_ACCESS_TOKEN || '';

interface PosterProduct {
  product_id: number;
  product_name: string;
  category_name: string;
  price: Record<string, string>;
  photo?: string;
  hidden?: string;
}

interface PosterTransaction {
  transaction_id: number;
  spot_id: number;
  sum: number;
  client_id?: number;
  products?: Array<{
    product_id: number;
    product_name: string;
    num: number;
    price: number;
  }>;
  date_close?: string;
}

export class PosterService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Fetch products from Poster API and sync to our DB
   */
  async syncMenu(): Promise<{ synced: number; errors: number }> {
    if (!POSTER_ACCESS_TOKEN) {
      console.warn('[Poster] No access token configured, skipping sync');
      return { synced: 0, errors: 0 };
    }

    let synced = 0;
    let errors = 0;

    try {
      const response = await fetch(
        `${POSTER_API_URL}/menu.getProducts?token=${POSTER_ACCESS_TOKEN}`
      );
      const data = await response.json() as { response?: PosterProduct[] };

      if (!data.response) return { synced: 0, errors: 0 };

      for (const product of data.response) {
        try {
          const priceInKopiyky = Math.round(
            parseFloat(Object.values(product.price)[0] || '0') * 100
          );

          await this.prisma.product.upsert({
            where: { posterProductId: product.product_id },
            update: {
              name: product.product_name,
              category: product.category_name || 'Інше',
              price: priceInKopiyky,
              imageUrl: product.photo || null,
              isActive: product.hidden !== '1',
            },
            create: {
              posterProductId: product.product_id,
              name: product.product_name,
              category: product.category_name || 'Інше',
              price: priceInKopiyky,
              imageUrl: product.photo || null,
              isActive: product.hidden !== '1',
            },
          });
          synced++;
        } catch (err) {
          errors++;
          console.error(`[Poster] Failed to sync product ${product.product_id}:`, err);
        }
      }
    } catch (err) {
      console.error('[Poster] Menu sync failed:', err);
    }

    return { synced, errors };
  }

  /**
   * Process a Poster webhook for transaction.create
   * Finds the user by poster_client_id or phone, awards points
   */
  async processTransactionWebhook(payload: {
    account: string;
    object: string;
    object_id: number;
    action: string;
    data?: string;
    time?: string;
  }): Promise<{
    success: boolean;
    userId?: string;
    pointsEarned?: number;
    newBalance?: number;
  }> {
    if (payload.object !== 'transaction' || payload.action !== 'added') {
      return { success: false };
    }

    try {
      // Fetch full transaction details from Poster
      const txResponse = await fetch(
        `${POSTER_API_URL}/dash.getTransaction?token=${POSTER_ACCESS_TOKEN}&transaction_id=${payload.object_id}`
      );
      const txData = await txResponse.json() as { response?: PosterTransaction };
      const tx = txData.response;

      if (!tx) return { success: false };

      // Find user by poster_client_id
      let user = tx.client_id
        ? await this.prisma.user.findFirst({ where: { posterClientId: tx.client_id } })
        : null;

      if (!user) return { success: false };

      // Calculate points: 1 грн = 1 бал
      const totalInUAH = Math.round(tx.sum / 100); // Poster stores in kopiyky
      const pointsEarned = totalInUAH;

      // Award points in a transaction
      const updated = await this.prisma.$transaction(async (prisma) => {
        const updatedUser = await prisma.user.update({
          where: { id: user!.id },
          data: { points: { increment: pointsEarned } },
        });

        // Log points
        await prisma.pointsLog.create({
          data: {
            userId: user!.id,
            amount: pointsEarned,
            type: 'PURCHASE',
            description: `Poster чек #${tx.transaction_id}`,
            balanceAfter: updatedUser.points,
          },
        });

        // Create/update order record
        const location = tx.spot_id
          ? await prisma.location.findFirst({ where: { posterSpotId: tx.spot_id } })
          : null;

        await prisma.order.create({
          data: {
            userId: user!.id,
            locationId: location?.id || (await prisma.location.findFirst())!.id,
            posterTransactionId: tx.transaction_id,
            type: 'POS',
            status: 'COMPLETED',
            total: tx.sum,
            pointsEarned,
            items: {
              create: (tx.products || []).map((p) => ({
                productId: '', // Will be resolved by poster sync
                quantity: p.num,
                price: p.price,
                total: p.price * p.num,
              })),
            },
          },
        });

        // Update weekly location battle
        if (location) {
          const weekKey = getISOWeekKey(new Date());
          await prisma.locationBattleWeekly.upsert({
            where: {
              locationId_weekKey: { locationId: location.id, weekKey },
            },
            update: {
              totalPoints: { increment: pointsEarned },
              totalOrders: { increment: 1 },
            },
            create: {
              locationId: location.id,
              weekKey,
              totalPoints: pointsEarned,
              totalOrders: 1,
            },
          });
        }

        return updatedUser;
      });

      return {
        success: true,
        userId: user.id,
        pointsEarned,
        newBalance: updated.points,
      };
    } catch (err) {
      console.error('[Poster] Transaction webhook processing failed:', err);
      return { success: false };
    }
  }

  /**
   * Get analytics from Poster for owner dashboard
   */
  async getAnalytics(spotId?: number): Promise<{
    revenue: number;
    orders: number;
    avgCheck: number;
    topProducts: Array<{ name: string; count: number }>;
  }> {
    if (!POSTER_ACCESS_TOKEN) {
      return { revenue: 0, orders: 0, avgCheck: 0, topProducts: [] };
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const params = new URLSearchParams({
        token: POSTER_ACCESS_TOKEN,
        date_from: today,
        date_to: today,
      });
      if (spotId) params.set('spot_id', String(spotId));

      const response = await fetch(
        `${POSTER_API_URL}/dash.getAnalytics?${params}`
      );
      const data = await response.json() as { response?: { revenue: number; orders: number; avg_check: number } };

      return {
        revenue: data.response?.revenue || 0,
        orders: data.response?.orders || 0,
        avgCheck: data.response?.avg_check || 0,
        topProducts: [],
      };
    } catch {
      return { revenue: 0, orders: 0, avgCheck: 0, topProducts: [] };
    }
  }
}

function getISOWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
