import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface Product {
  id: string;
  name: string;
  description: string | null;
  volume: string | null;
  price: string;
  category: string;
  imageUrl: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

interface MenuProps {
  apiUrl: string;
  cart: CartItem[];
  onCartChange: (cart: CartItem[]) => void;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
  canPreorder?: boolean;
}

const CATEGORY_ICONS: Record<string, string> = {
  'Кава': '☕',
  'Холодні напої': '🧊',
  'Не кава': '🍵',
  'Їжа': '🍔',
  'Кава на продаж': '📦',
};

export function Menu({ apiUrl, cart, onCartChange, theme, canPreorder = true }: MenuProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const response = await axios.get<{ products: Product[] }>(`${apiUrl}/api/products`);
      setProducts(response.data.products);
    } catch (err) {
      console.error('[Menu] Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  };

  const CATEGORY_ORDER = ['Кава', 'Холодні напої', 'Не кава', 'Їжа', 'Кава на продаж'];

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => cats.add(p.category));
    return CATEGORY_ORDER.filter(c => cats.has(c)).concat(
      Array.from(cats).filter(c => !CATEGORY_ORDER.includes(c))
    );
  }, [products]);

  // Set first category as active if none selected
  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  const filteredProducts = useMemo(() => {
    if (!activeCategory) return products;
    return products.filter(p => p.category === activeCategory);
  }, [products, activeCategory]);

  const getCartQuantity = (productId: string) => {
    return cart.find(item => item.product.id === productId)?.quantity || 0;
  };

  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.product.id === product.id);
    if (existing) {
      onCartChange(cart.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      onCartChange([...cart, { product, quantity: 1 }]);
    }
  };

  const removeFromCart = (productId: string) => {
    const existing = cart.find(item => item.product.id === productId);
    if (!existing) return;
    if (existing.quantity <= 1) {
      onCartChange(cart.filter(item => item.product.id !== productId));
    } else {
      onCartChange(cart.map(item =>
        item.product.id === productId
          ? { ...item, quantity: item.quantity - 1 }
          : item
      ));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: theme.buttonColor, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div>
      {/* View-only banner */}
      {!canPreorder && (
        <div className="mb-4 p-3 rounded-xl text-center text-sm" style={{ backgroundColor: '#FFF8E1', color: '#92400e' }}>
          📍 Замовляйте на місці! Попереднє замовлення тут недоступне.
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap"
            style={{
              backgroundColor: activeCategory === cat ? theme.buttonColor : theme.bgColor,
              color: activeCategory === cat ? theme.buttonTextColor : theme.textColor,
            }}
          >
            {CATEGORY_ICONS[cat] || '📦'} {cat}
          </button>
        ))}
      </div>

      {/* Product list */}
      <div className="space-y-3">
        {filteredProducts.map(product => {
          const qty = getCartQuantity(product.id);
          const price = parseFloat(product.price);

          return (
            <div
              key={product.id}
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ backgroundColor: theme.bgColor }}
            >
              {/* Product image placeholder */}
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ backgroundColor: theme.secondaryBgColor }}
              >
                {CATEGORY_ICONS[product.category] || '📦'}
              </div>

              {/* Product info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm" style={{ color: theme.textColor }}>
                  {product.name}
                  {product.volume && (
                    <span className="font-normal ml-1" style={{ color: theme.hintColor }}>
                      {product.volume}
                    </span>
                  )}
                </h3>
                {product.description && (
                  <p className="text-xs mt-0.5 truncate" style={{ color: theme.hintColor }}>
                    {product.description}
                  </p>
                )}
                <p className="font-bold text-sm mt-1" style={{ color: theme.buttonColor }}>
                  {price} грн
                </p>
              </div>

              {/* Add/remove buttons (only if preorder is available) */}
              {canPreorder && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {qty > 0 ? (
                    <>
                      <button
                        onClick={() => removeFromCart(product.id)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-all active:scale-90"
                        style={{ backgroundColor: theme.hintColor + '30', color: theme.textColor }}
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-bold text-sm" style={{ color: theme.textColor }}>
                        {qty}
                      </span>
                      <button
                        onClick={() => addToCart(product)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-all active:scale-90"
                        style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
                      >
                        +
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => addToCart(product)}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95"
                      style={{ backgroundColor: theme.buttonColor + '15', color: theme.buttonColor }}
                    >
                      +
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {products.length === 0 && (
        <div className="text-center py-12">
          <p style={{ color: theme.hintColor }}>Меню поки пусте</p>
        </div>
      )}
    </div>
  );
}
