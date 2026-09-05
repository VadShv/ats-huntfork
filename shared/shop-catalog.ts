/**
 * Shop catalog — cosmetic items bought with coins. One-time purchases;
 * one item can be equipped per type slot (frame / title / accent).
 */
export type ShopItemType = 'frame' | 'title' | 'accent'

export interface ShopItem {
  key: string
  type: ShopItemType
  name: string
  description: string
  cost: number
  /** For frame/accent: a CSS value (gradient/color). For title: the text shown. */
  value: string
  icon: string
}

export const SHOP_CATALOG: ShopItem[] = [
  // ── Рамки аватара (frame = CSS gradient) ──
  { key: 'frame_bronze', type: 'frame', name: 'Бронзовая рамка', description: 'Рамка аватара', cost: 100, value: 'linear-gradient(135deg,#b45309,#92400e)', icon: '🥉' },
  { key: 'frame_silver', type: 'frame', name: 'Серебряная рамка', description: 'Рамка аватара', cost: 250, value: 'linear-gradient(135deg,#94a3b8,#475569)', icon: '🥈' },
  { key: 'frame_gold', type: 'frame', name: 'Золотая рамка', description: 'Рамка аватара', cost: 600, value: 'linear-gradient(135deg,#fbbf24,#d97706)', icon: '🥇' },
  { key: 'frame_neon', type: 'frame', name: 'Неоновая рамка', description: 'Рамка аватара', cost: 1000, value: 'linear-gradient(135deg,#22d3ee,#a855f7)', icon: '💠' },

  // ── Титулы (title = text) ──
  { key: 'title_hunter', type: 'title', name: 'Титул «Охотник»', description: 'Отображается в профиле', cost: 200, value: 'Охотник', icon: '🎯' },
  { key: 'title_closer', type: 'title', name: 'Титул «Закрыватель»', description: 'Отображается в профиле', cost: 400, value: 'Закрыватель', icon: '🔒' },
  { key: 'title_sniper', type: 'title', name: 'Титул «Снайпер»', description: 'Отображается в профиле', cost: 800, value: 'Снайпер', icon: '🔥' },
  { key: 'title_legend', type: 'title', name: 'Титул «Легенда найма»', description: 'Отображается в профиле', cost: 1500, value: 'Легенда найма', icon: '👑' },

  // ── Акцентные цвета (accent = color) ──
  { key: 'accent_teal', type: 'accent', name: 'Акцент «Бирюза»', description: 'Цвет профиля', cost: 150, value: '#01696f', icon: '🎨' },
  { key: 'accent_violet', type: 'accent', name: 'Акцент «Фиолет»', description: 'Цвет профиля', cost: 150, value: '#7c3aed', icon: '🎨' },
  { key: 'accent_amber', type: 'accent', name: 'Акцент «Янтарь»', description: 'Цвет профиля', cost: 150, value: '#d97706', icon: '🎨' },
]

export function shopItem(key: string): ShopItem | undefined {
  return SHOP_CATALOG.find(i => i.key === key)
}
