/**
 * Центр аналитики: единая цветовая палитра и базовые опции для ECharts.
 *
 * Значения синхронизированы с Tailwind-палитрой проекта (zinc/эмерод/аметист).
 * Тема применяется вручную в опциях каждого графика (не через echarts.registerTheme),
 * чтобы оставаться SSR-безопасной и tree-shakeable.
 */

/** Основная качественная палитра для серий (line/bar/sankey nodes). */
export const CHART_PALETTE = [
  '#6366f1', // indigo-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#3b82f6', // blue-500
  '#a855f7', // purple-500
  '#14b8a6', // teal-500
  '#ec4899', // pink-500
]

/** Семантические цвета для метрик воронки/статусов. */
export const CHART_SEMANTIC = {
  positive: '#10b981', // наймы / forward
  negative: '#ef4444', // отказы / rejected
  warning: '#f59e0b', // SLA warning
  neutral: '#6366f1', // нейтральная метрика
  backward: '#a1a1aa', // ходы назад (zinc-400)
  muted: '#71717a', // zinc-500
} as const

export interface ChartThemeColors {
  text: string
  textMuted: string
  axisLine: string
  splitLine: string
  tooltipBg: string
  tooltipBorder: string
}

/** Цвета осей/подписей/тултипа в зависимости от темы. */
export function themeColors(dark: boolean): ChartThemeColors {
  return dark
    ? {
        text: '#e4e4e7', // zinc-200
        textMuted: '#a1a1aa', // zinc-400
        axisLine: '#3f3f46', // zinc-700
        splitLine: '#27272a', // zinc-800
        tooltipBg: '#18181b', // zinc-900
        tooltipBorder: '#3f3f46', // zinc-700
      }
    : {
        text: '#3f3f46', // zinc-700
        textMuted: '#71717a', // zinc-500
        axisLine: '#d4d4d8', // zinc-300
        splitLine: '#f4f4f5', // zinc-100
        tooltipBg: '#ffffff',
        tooltipBorder: '#e4e4e7', // zinc-200
      }
}

/**
 * Базовый каркас опций (grid/tooltip/legend/textStyle) для декартовых графиков.
 * Возвращает частичный EChartsOption — сериям добавляйте поверх через spread.
 */
export function baseCartesianOption(dark: boolean) {
  const c = themeColors(dark)
  return {
    color: CHART_PALETTE,
    textStyle: {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      color: c.text,
    },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: c.text, fontSize: 12 },
      axisPointer: { type: 'shadow' as const },
    },
    legend: {
      top: 0,
      right: 8,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: c.textMuted, fontSize: 11 },
    },
  }
}

/** Утилита форматирования дат тренда по гранулярности. */
export function formatTrendLabel(iso: string, groupBy: 'day' | 'week' | 'month'): string {
  const d = new Date(iso)
  if (groupBy === 'month') {
    return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
  }
  if (groupBy === 'week') {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
