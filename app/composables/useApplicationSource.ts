/**
 * useApplicationSource — единый источник правды для отрисовки бейджей источника отклика.
 *
 * `application.source` в БД может быть:
 *   'hh'           — кандидат сам откликнулся через hh.ru
 *   'hh_sourcing'  — «холодный» кандидат, импортированный нами через hh-сорсинг
 *   'manual'       — добавлен вручную рекрутером
 *   'api'          — пришёл через внешний API
 *
 * Sprint 3 (Variant A): один общий поток в канбане/таблице + визуальные бейджи,
 * чтобы было видно «отклик vs холодный». Composable возвращает label/icon/color/tooltip,
 * чтобы во всех местах UI стиль был согласован.
 */
import { type Component, computed, type ComputedRef } from 'vue'
import { Inbox, Plug, Snowflake, UserPlus } from 'lucide-vue-next'

export type ApplicationSource = 'hh' | 'hh_sourcing' | 'manual' | 'api' | string | null | undefined

export interface ApplicationSourceMeta {
  /** Канонический тип: hh | hh_sourcing | manual | api | other */
  key: 'hh' | 'hh_sourcing' | 'manual' | 'api' | 'other'
  /** Короткая подпись для бейджа. */
  label: string
  /** Расширенный tooltip для hover. */
  tooltip: string
  /** Иконка (lucide-vue-next). */
  icon: Component
  /** Цветовые tailwind-классы для бейджа (bg + text). */
  badgeClass: string
  /** Цветовые tailwind-классы только для иконки (если показываем без текста). */
  iconClass: string
  /** True — это «холодный» сорсинг-кандидат (для фильтра «Скрыть холодных»). */
  isCold: boolean
}

const META: Record<ApplicationSourceMeta['key'], ApplicationSourceMeta> = {
  hh: {
    key: 'hh',
    label: 'Отклик hh.ru',
    tooltip: 'Кандидат сам откликнулся через hh.ru',
    icon: Inbox,
    badgeClass: 'bg-blue-100 text-blue-800',
    iconClass: 'text-blue-600',
    isCold: false,
  },
  hh_sourcing: {
    key: 'hh_sourcing',
    label: 'Холодный (hh.ru)',
    tooltip: 'Найден через сорсинг hh.ru — раскрытие контактов сделали мы, отклика не было',
    icon: Snowflake,
    badgeClass: 'bg-sky-100 text-sky-800',
    iconClass: 'text-sky-600',
    isCold: true,
  },
  manual: {
    key: 'manual',
    label: 'Вручную',
    tooltip: 'Кандидат добавлен рекрутером вручную',
    icon: UserPlus,
    badgeClass: 'bg-slate-100 text-slate-700',
    iconClass: 'text-slate-500',
    isCold: false,
  },
  api: {
    key: 'api',
    label: 'Внешний API',
    tooltip: 'Создан через внешний API',
    icon: Plug,
    badgeClass: 'bg-violet-100 text-violet-800',
    iconClass: 'text-violet-600',
    isCold: false,
  },
  other: {
    key: 'other',
    label: 'Источник неизвестен',
    tooltip: 'Тип источника не распознан',
    icon: UserPlus,
    badgeClass: 'bg-slate-100 text-slate-600',
    iconClass: 'text-slate-400',
    isCold: false,
  },
}

function resolveMeta(source: ApplicationSource): ApplicationSourceMeta {
  if (source === 'hh') return META.hh
  if (source === 'hh_sourcing') return META.hh_sourcing
  if (source === 'manual') return META.manual
  if (source === 'api') return META.api
  return META.other
}

/**
 * Если нужна реактивность — передаём computed source.
 * Если знаем source как plain string — берём `getApplicationSourceMeta(source)`.
 */
export function useApplicationSource(source: () => ApplicationSource): ComputedRef<ApplicationSourceMeta> {
  return computed(() => resolveMeta(source()))
}

export function getApplicationSourceMeta(source: ApplicationSource): ApplicationSourceMeta {
  return resolveMeta(source)
}
