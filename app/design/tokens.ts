/**
 * Huntfork Design Tokens
 * ─────────────────────────────────────────────────────────
 * Единый источник правды для всех дизайн-значений приложения.
 *
 * Архитектура:
 *   • Tailwind v4 @theme в app/assets/css/main.css ↔ источник CSS-переменных
 *   • Этот файл — TypeScript-зеркало для использования из VUE/TS-кода
 *     (когда нужна типизация — например список цветов для UiBadge variant'ов).
 *
 * Правило: если меняешь значение — меняй В ДВУХ местах (main.css + tokens.ts).
 * В будущем (Этап 5+) — генерация одного из другого, но пока ручная синхронизация.
 *
 * Использование:
 *   import { colors, radii, spacing, shadows, durations, zIndex } from '~/design/tokens'
 *   colors.brand[600]  // CSS-переменная 'var(--color-brand-600)'
 */

// ─────────────────────────────────────────────────────────
// Цвета — обёртка над CSS-переменными из @theme в main.css
// ─────────────────────────────────────────────────────────

type ColorScale = {
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
  950: string
}

const scale = (name: string): ColorScale => ({
  50: `var(--color-${name}-50)`,
  100: `var(--color-${name}-100)`,
  200: `var(--color-${name}-200)`,
  300: `var(--color-${name}-300)`,
  400: `var(--color-${name}-400)`,
  500: `var(--color-${name}-500)`,
  600: `var(--color-${name}-600)`,
  700: `var(--color-${name}-700)`,
  800: `var(--color-${name}-800)`,
  900: `var(--color-${name}-900)`,
  950: `var(--color-${name}-950)`,
})

export const colors = {
  /** Brand — cornflower blue (#6389ff). Primary actions, active nav, links. */
  brand: scale('brand'),
  /** Accent — teal. AI-insight indicators, sparingly. */
  accent: scale('accent'),
  /** Surface — near-neutral grays. Backgrounds, borders, text. */
  surface: scale('surface'),
  /** Success — emerald. Hired, active, verified states. */
  success: scale('success'),
  /** Warning — amber. Drafts, pending, expiring. */
  warning: scale('warning'),
  /** Danger — rose. Rejected, errors, destructive actions. */
  danger: scale('danger'),
  /** Info — sky. Informational notices, help text. */
  info: scale('info'),
} as const

export type ColorName = keyof typeof colors
export type ColorShade = keyof ColorScale

// ─────────────────────────────────────────────────────────
// Типографика
// ─────────────────────────────────────────────────────────

export const typography = {
  /** Основное семейство — PT Astra Fact + системные fallback (см. main.css). */
  fontFamily: {
    sans: '"PT Astra Fact", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, monospace',
  },
  /** Размеры — соответствуют Tailwind text-{xs..2xl}. */
  fontSize: {
    xs: '0.75rem',    // 12px — chip labels, captions
    sm: '0.875rem',   // 14px — body small, dense UI
    base: '1rem',     // 16px — основной текст
    lg: '1.125rem',   // 18px — секционные подзаголовки
    xl: '1.25rem',    // 20px — заголовки карточек
    '2xl': '1.5rem',  // 24px — заголовки страниц
    '3xl': '1.875rem',// 30px — hero
    '4xl': '2.25rem', // 36px — landing hero
  },
  /** Веса. */
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  /** Межстрочные. */
  lineHeight: {
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
  },
  /** Межбуквенные. */
  letterSpacing: {
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
  },
} as const

// ─────────────────────────────────────────────────────────
// Радиусы
// ─────────────────────────────────────────────────────────

export const radii = {
  none: '0',
  sm: '0.25rem',    // 4px — мелкие chip'ы, бейджи
  md: '0.375rem',   // 6px — inputs (legacy)
  lg: '0.5rem',     // 8px — кнопки, инпуты (текущий стандарт)
  xl: '0.75rem',    // 12px — карточки, dropdown'ы
  '2xl': '1rem',    // 16px — модалки, drawer'ы
  '3xl': '1.5rem',  // 24px — большие hero-блоки
  full: '9999px',   // pill — статус-бейджи, аватары
} as const

export type RadiusToken = keyof typeof radii

// ─────────────────────────────────────────────────────────
// Отступы (наша сетка)
// ─────────────────────────────────────────────────────────

export const spacing = {
  0: '0',
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem',    // 4px
  1.5: '0.375rem', // 6px
  2: '0.5rem',     // 8px
  2.5: '0.625rem', // 10px
  3: '0.75rem',    // 12px
  4: '1rem',       // 16px
  5: '1.25rem',    // 20px
  6: '1.5rem',     // 24px
  8: '2rem',       // 32px
  10: '2.5rem',    // 40px
  12: '3rem',      // 48px
  16: '4rem',      // 64px
} as const

// ─────────────────────────────────────────────────────────
// Тени — три уровня elevation
// ─────────────────────────────────────────────────────────

export const shadows = {
  /** Нет тени — flat элементы. */
  none: 'none',
  /** Низкий — мелкие dropdown'ы, поповеры. */
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  /** Базовый — карточки, выпадающие меню. */
  md: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
  /** Высокий — модалки, drawer'ы. */
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)',
  /** Очень высокий — picker'ы, AI-popover'ы поверх модалок. */
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.10), 0 8px 10px -6px rgb(0 0 0 / 0.05)',
  /** Inset для нажатых состояний. */
  inset: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.06)',
} as const

// ─────────────────────────────────────────────────────────
// Анимации — длительности и easing
// ─────────────────────────────────────────────────────────

export const durations = {
  /** Мгновенные микро-feedback (hover, click). */
  fast: '150ms',
  /** Базовые transitions (открытие dropdown, smooth state change). */
  base: '250ms',
  /** Открытие модалок, drawer'ов, страничных переходов. */
  slow: '400ms',
  /** Медленные emphasis-анимации (онбординг, success-celebrations). */
  slower: '600ms',
} as const

export const easings = {
  /** Стандартный — для большинства UI-переходов. */
  base: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Linear-style — премиум "deceleration", для hero/page transitions. */
  premium: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Spring-like — для микро-интеракций с лёгким overshoot. */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** Линейный — для прогресс-баров и индикаторов. */
  linear: 'linear',
} as const

// ─────────────────────────────────────────────────────────
// Z-index — иерархия слоёв
// ─────────────────────────────────────────────────────────

export const zIndex = {
  base: 0,
  /** Sticky-элементы (sticky header в таблице, sticky-tab-bar). */
  sticky: 10,
  /** Sidebar / приклеенные панели. */
  sidebar: 20,
  /** Topbar / sticky-навигация уровня страницы. */
  topbar: 30,
  /** Dropdown / popover / context-menu. */
  dropdown: 40,
  /** Drawer (выезжающие боковые панели). */
  drawer: 50,
  /** Modal (диалоги по центру). */
  modal: 60,
  /** Toast (всплывающие уведомления). */
  toast: 70,
  /** Tooltip — поверх всего. */
  tooltip: 80,
} as const

// ─────────────────────────────────────────────────────────
// Состояния фокуса — единый focus ring
// ─────────────────────────────────────────────────────────

export const focus = {
  /** Tailwind-классы для focus-visible ring (используется в UiButton, UiInput). */
  ring: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950',
  /** Для деструктивных элементов — danger ring. */
  ringDanger: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-50 dark:focus-visible:ring-offset-surface-950',
} as const

// ─────────────────────────────────────────────────────────
// Размеры компонентов — общие пресеты sm/md/lg
// ─────────────────────────────────────────────────────────

export const sizes = {
  /** Высоты для button/input/select — единая шкала. */
  control: {
    sm: '1.75rem',  // 28px — компактные таблицы, фильтры
    md: '2.25rem',  // 36px — стандарт
    lg: '2.75rem',  // 44px — выдающиеся CTA, hero-формы
  },
  /** Padding-x для control-элементов соответствующих размеров. */
  controlPaddingX: {
    sm: '0.625rem', // 10px
    md: '0.875rem', // 14px
    lg: '1.125rem', // 18px
  },
  /** Размеры иконок внутри controls. */
  controlIcon: {
    sm: '0.875rem', // 14px (lucide size=14)
    md: '1rem',     // 16px (lucide size=16)
    lg: '1.125rem', // 18px (lucide size=18)
  },
} as const

export type ControlSize = keyof typeof sizes.control

// ─────────────────────────────────────────────────────────
// Семантические токены — связи "роль → цветовая шкала"
// ─────────────────────────────────────────────────────────

/**
 * Семантические роли цветов. UI-компоненты ссылаются на эти имена,
 * а не на конкретные шкалы — тогда смена brand'а с blue на green
 * не требует правок в компонентах.
 */
export const semanticColors = {
  primary: 'brand',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'surface',
} as const

export type SemanticColor = keyof typeof semanticColors

// ─────────────────────────────────────────────────────────
// Экспорт всего одним default'ом для удобства
// ─────────────────────────────────────────────────────────

export const tokens = {
  colors,
  typography,
  radii,
  spacing,
  shadows,
  durations,
  easings,
  zIndex,
  focus,
  sizes,
  semanticColors,
} as const

export default tokens
