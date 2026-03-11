/**
 * Poster POS Integration Service
 */

import { PrismaClient } from '@prisma/client';

const POSTER_API_URL = 'https://joinposter.com/api';
const POSTER_ACCESS_TOKEN = process.env.POSTER_ACCESS_TOKEN || '';

type PosterPriceMap = Record<string, string | number>;

interface PosterCategory {
  category_id: number | string;
  category_name: string;
  hidden?: string | number;
}

interface PosterProduct {
  product_id: number | string;
  product_name: string;
  category_name?: string;
  menu_category_id?: number | string;
  price: PosterPriceMap | string | number;
  photo?: string;
  hidden?: string | number;
}


interface PosterIncomingOrderResponse {
  incoming_order_id?: number | string;
  order_id?: number | string;
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
}

function toNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Poster can send price as kopiyky integer, decimal hryvnia string, or stringified integer.
 * Keep DB format as integer kopiyky.
 */
function normalizePosterPriceToKopiyky(price: PosterProduct['price']): number {
  const candidateValues: Array<string | number> =
    typeof price === 'object' && price !== null ? Object.values(price) : [price];

  const first = candidateValues.find((v) => v !== undefined && v !== null && String(v).trim() !== '');
  if (first === undefined) return 0;

  const raw = String(first).replace(',', '.').trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;

  if (raw.includes('.')) {
    return Math.round(parsed * 100);
  }

  // Heuristic:
  // - values >= 1000 are usually already kopiyky (e.g. 5500)
  // - small integers are likely hryvnia (e.g. 55)
  if (parsed >= 1000) return Math.round(parsed);
  return Math.round(parsed * 100);
}

export class PosterService {
  constructor(private prisma: PrismaClient) {}

  private buildUrl(method: string, params: Record<string, string> = {}): string {
    const query = new URLSearchParams({ token: POSTER_ACCESS_TOKEN, ...params });
    return `${POSTER_API_URL}/${method}?${query.toString()}`;
  }

  async getCategories(): Promise<PosterCategory[]> {
    if (!POSTER_ACCESS_TOKEN) return [];
    const response = await fetch(this.buildUrl('menu.getCategories'));
    const data = (await response.json()) as { response?: PosterCategory[] };
    return data.response || [];
  }

  async getProducts(): Promise<PosterProduct[]> {
    if (!POSTER_ACCESS_TOKEN) return [];
    const response = await fetch(this.buildUrl('menu.getProducts'));
    const data = (await response.json()) as { response?: PosterProduct[] };
    return data.response || [];
  }


  async getProduct(productId: number): Promise<PosterProduct | null> {
    if (!POSTER_ACCESS_TOKEN) return null;
    const response = await fetch(this.buildUrl('menu.getProduct', { product_id: String(productId) }));
    const data = (await response.json()) as { response?: PosterProduct | PosterProduct[] };
    const payload = data.response;
    if (!payload) return null;
    return Array.isArray(payload) ? (payload[0] || null) : payload;
  }

  async syncProductByPosterId(productId: number): Promise<boolean> {
    const product = await this.getProduct(productId);
    if (!product) return false;

    const categories = await this.getCategories();
    const normalizedPrice = normalizePosterPriceToKopiyky(product.price);
    const categoryNameFromId = (() => {
      const catId = toNumber(product.menu_category_id);
      if (catId === null) return null;
      const found = categories.find((c) => toNumber(c.category_id) === catId);
      return found?.category_name || null;
    })();
    const categoryName = product.category_name || categoryNameFromId || 'Інше';

    await this.prisma.product.upsert({
      where: { posterId: String(productId) },
      update: {
        posterId: String(productId),
        posterProductId: productId,
        name: product.product_name,
        category: categoryName,
        price: normalizedPrice,
        imageUrl: product.photo || null,
        isActive: String(product.hidden ?? '0') !== '1',
      },
      create: {
        posterId: String(productId),
        posterProductId: productId,
        name: product.product_name,
        category: categoryName,
        price: normalizedPrice,
        imageUrl: product.photo || null,
        isActive: String(product.hidden ?? '0') !== '1',
      },
    });

    return true;
  }

  async softDeleteProductByPosterId(productId: number): Promise<boolean> {
    const existing = await this.prisma.product.findFirst({
      where: { OR: [{ posterId: String(productId) }, { posterProductId: productId }] },
      select: { id: true },
    });

    if (!existing) return false;

    await this.prisma.product.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    return true;
  }

  /**
   * Sync categories + products from Poster into Prisma.
   * Keeps product_id from Poster in DB as `posterId` (critical for cart flow).
   */
  async syncMenu(): Promise<{ categoriesSynced: number; productsSynced: number; errors: number }> {
    if (!POSTER_ACCESS_TOKEN) {
      console.warn('[Poster] No access token configured, skipping sync');
      return { categoriesSynced: 0, productsSynced: 0, errors: 0 };
    }

    let categoriesSynced = 0;
    let productsSynced = 0;
    let errors = 0;

    try {
      const [categories, products] = await Promise.all([this.getCategories(), this.getProducts()]);

      await this.prisma.$transaction(async (tx) => {
        // 1) Categories sync
        for (const category of categories) {
          const posterCategoryId = toNumber(category.category_id);
          if (posterCategoryId === null) {
            errors++;
            continue;
          }

          await tx.category.upsert({
            where: { posterId: posterCategoryId },
            update: {
              name: category.category_name,
              isActive: String(category.hidden ?? '0') !== '1',
            },
            create: {
              posterId: posterCategoryId,
              name: category.category_name,
              isActive: String(category.hidden ?? '0') !== '1',
            },
          });
          categoriesSynced++;
        }

        // 2) Products sync
        for (const product of products) {
          const posterProductId = toNumber(product.product_id);
          if (posterProductId === null) {
            errors++;
            continue;
          }

          const normalizedPrice = normalizePosterPriceToKopiyky(product.price);

          // resolve category name from product payload or fallback by category id
          const categoryNameFromId = (() => {
            const catId = toNumber(product.menu_category_id);
            if (catId === null) return null;
            const found = categories.find((c) => toNumber(c.category_id) === catId);
            return found?.category_name || null;
          })();

          const categoryName = product.category_name || categoryNameFromId || 'Інше';

          await tx.product.upsert({
            where: { posterId: String(posterProductId) },
            update: {
              // critical mapping
              posterId: String(posterProductId),
              posterProductId: posterProductId,
              name: product.product_name,
              category: categoryName,
              price: normalizedPrice,
              imageUrl: product.photo || null,
              isActive: String(product.hidden ?? '0') !== '1',
            },
            create: {
              posterId: String(posterProductId),
              posterProductId: posterProductId,
              name: product.product_name,
              category: categoryName,
              price: normalizedPrice,
              imageUrl: product.photo || null,
              isActive: String(product.hidden ?? '0') !== '1',
            },
          });

          productsSynced++;
        }

        // 3) Deactivate missing Poster records (soft-clean)
        const activeCategoryIds = categories
          .map((c) => toNumber(c.category_id))
          .filter((id): id is number => id !== null);

        const activeProductIds = products
          .map((p) => toNumber(p.product_id))
          .filter((id): id is number => id !== null)
          .map((id) => String(id));

        await tx.category.updateMany({
          where: { posterId: { notIn: activeCategoryIds } },
          data: { isActive: false },
        });

        await tx.product.updateMany({
          where: {
            posterId: { not: null, notIn: activeProductIds },
          },
          data: { isActive: false },
        });
      });
    } catch (err) {
      console.error('[Poster] Menu sync failed:', err);
      errors++;
    }

    return { categoriesSynced, productsSynced, errors };
  }

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
      const txResponse = await fetch(
        `${POSTER_API_URL}/dash.getTransaction?token=${POSTER_ACCESS_TOKEN}&transaction_id=${payload.object_id}`
      );
      const txData = await txResponse.json() as { response?: PosterTransaction };
      const tx = txData.response;

      if (!tx) return { success: false };

      const user = tx.client_id
        ? await this.prisma.user.findFirst({ where: { posterClientId: tx.client_id } })
        : null;

      if (!user) return { success: false };

      const totalInUAH = Math.round(tx.sum / 100);
      const pointsEarned = totalInUAH;

      const updated = await this.prisma.$transaction(async (prisma) => {
        const updatedUser = await prisma.user.update({
          where: { id: user.id },
          data: { points: { increment: pointsEarned } },
        });

        await prisma.pointsLog.create({
          data: {
            userId: user.id,
            amount: pointsEarned,
            type: 'PURCHASE',
            description: `Poster чек #${tx.transaction_id}`,
            balanceAfter: updatedUser.points,
          },
        });

        const location = tx.spot_id
          ? await prisma.location.findFirst({ where: { posterSpotId: tx.spot_id } })
          : null;

        await prisma.order.create({
          data: {
            userId: user.id,
            locationId: location?.id || (await prisma.location.findFirst())!.id,
            posterTransactionId: tx.transaction_id,
            type: 'POS',
            status: 'COMPLETED',
            total: tx.sum,
            pointsEarned,
            items: {
              create: (tx.products || []).map((p) => ({
                productId: '',
                quantity: p.num,
                price: p.price,
                total: p.price * p.num,
              })),
            },
          },
        });

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
   * After payment provider confirms successful payment,
   * send order to Poster incomingOrders.createIncomingOrder
   * and save returned incoming_order_id to Order.posterOrderId.
   */
  async createIncomingOrderForPaidOrder(orderId: string): Promise<{ success: boolean; posterOrderId?: string; reason?: string }> {
    if (!POSTER_ACCESS_TOKEN) {
      return { success: false, reason: 'POSTER_TOKEN_MISSING' };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        location: { select: { posterSpotId: true } },
        items: { include: { product: { select: { posterId: true, posterProductId: true } } } },
      },
    });

    if (!order) return { success: false, reason: 'ORDER_NOT_FOUND' };
    if (order.posterOrderId) return { success: true, posterOrderId: order.posterOrderId };

    const spotId = order.location.posterSpotId || Number(process.env.POSTER_SPOT_ID || 0);
    if (!spotId) return { success: false, reason: 'SPOT_ID_MISSING' };

    const products = order.items
      .map((item) => {
        const productPosterId = item.product.posterId || (item.product.posterProductId ? String(item.product.posterProductId) : null);
        if (!productPosterId) return null;
        return {
          product_id: Number(productPosterId),
          count: item.quantity,
        };
      })
      .filter((item): item is { product_id: number; count: number } => item !== null && Number.isFinite(item.product_id));

    if (products.length === 0) {
      return { success: false, reason: 'NO_PRODUCTS_WITH_POSTER_ID' };
    }

    const payload = {
      spot_id: spotId,
      products,
      payment: {
        type: 1,
        sum: order.total,
        currency: 'UAH',
      },
    };

    const response = await fetch(`${POSTER_API_URL}/incomingOrders.createIncomingOrder?token=${POSTER_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { response?: PosterIncomingOrderResponse };
    const incomingOrderIdRaw = data.response?.incoming_order_id ?? data.response?.order_id;
    const incomingOrderId = incomingOrderIdRaw !== undefined ? String(incomingOrderIdRaw) : "";

    if (!response.ok || !incomingOrderId) {
      return { success: false, reason: 'POSTER_CREATE_INCOMING_FAILED' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { posterOrderId: incomingOrderId },
    });

    return { success: true, posterOrderId: incomingOrderId };
  }

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

      const response = await fetch(`${POSTER_API_URL}/dash.getAnalytics?${params}`);
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
