/**
 * narrative.ts — повествовательная анимация и слоистость.
 * ТЗ «Повествовательная анимация» v1.0.
 *
 * Пять приёмов:
 *  1. useCountUp       — числа, которые доезжают (§1)
 *  2. useViewMorph     — морфинг через View Transitions API (§2)
 *  3. useStickyHeaders — слипающиеся заголовки через IO (§3)
 *  4. useAdaptiveGlass — адаптивное стекло (§4)
 *  5. useRubberScroll  — резиновая прокрутка на границах (§5)
 *
 * rAF НЕ используется — в CDP-controlled sidepanel он не срабатывает.
 * Все циклы анимации на setTimeout через useFrameScheduler из signature.ts.
 */

import { ref, computed, watch, onScopeDispose, type Ref, type ComputedRef } from 'vue'
import { useFrameScheduler } from './signature'

/* ═══════════════════════════════════════════════════════════════
 * §1. Доезжающие числа
 * ═══════════════════════════════════════════════════════════════ */

const _nf0 = new Intl.NumberFormat('ru-RU')
const _nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function formatNumber(val: number, decimals: number, compact: boolean): string {
  if (compact && val >= 10000) {
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
    return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  }
  if (decimals > 0) return _nf1.format(val)
  return _nf0.format(Math.round(val))
}

/** Реестр «считали один раз» — живёт в модуле, не в компоненте. */
const _countedOnce = new Set<string>()

export interface CountUpOptions {
  /** Уникальный ID для реестра countedOnce. */
  id?: string
  /** Знаков после запятой. */
  decimals?: number
  /** Компактный формат (12.4K, 1.2M). */
  compact?: boolean
  /** Базовая длительность. */
  duration?: number
  /** Суффикс (%, /100 и т.д.) — не анимируется. */
  suffix?: string
}

export interface CountUpReturn {
  display: ComputedRef<string>
  finalDisplay: ComputedRef<string>
  minWidthCh: ComputedRef<string>
}

/**
 * Число, доезжающее от предыдущего значения к новому.
 *
 * Длительность растёт логарифмически: 900мс базовая, потолок 1400мс.
 * Кривая — кубический ease-out: 1 - (1-t)³.
 * Ноль не анимируется.
 */
export function useCountUp(
  target: Ref<number> | ComputedRef<number> | (() => number),
  opts: CountUpOptions = {},
): CountUpReturn {
  const {
    id,
    decimals = 0,
    compact = false,
    duration = 900,
    suffix = '',
  } = opts

  const getTarget = typeof target === 'function'
    ? computed(target)
    : 'value' in target
      ? (target as ComputedRef<number>)
      : (target as Ref<number>)

  const current = ref(0)
  const scheduler = useFrameScheduler()

  // Проверяем reduced-motion через matchMedia
  const prefersReduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  function computeDuration(delta: number): number {
    if (delta <= 1) return 900
    // Логарифмический рост: ln(delta) с обрезкой
    const growth = Math.log(Math.min(delta, 1000)) * 70
    return Math.min(900 + growth, 1400)
  }

  function animate(from: number, to: number, dur: number) {
    if (from === to || to === 0) {
      current.value = to
      return
    }
    const start = performance.now()
    const step = () => {
      const elapsed = performance.now() - start
      const t = Math.min(elapsed / dur, 1)
      // Кубический ease-out: 1 - (1-t)³
      const eased = 1 - Math.pow(1 - t, 3)
      current.value = from + (to - from) * eased
      if (t < 1) {
        scheduler.schedule(step)
      } else {
        current.value = to // Точный финал, без накопленной погрешности
      }
    }
    scheduler.schedule(step)
  }

  watch(
    getTarget,
    (newVal, oldVal) => {
      // Повторный показ без анимации
      if (id && _countedOnce.has(id) && prefersReduced) {
        current.value = newVal
        return
      }
      if (id) _countedOnce.add(id)

      if (prefersReduced) {
        current.value = newVal
        return
      }

      const from = oldVal ?? 0
      const delta = Math.abs(newVal - from)
      const dur = computeDuration(delta)
      animate(from, newVal, dur)
    },
    { immediate: true },
  )

  const display = computed(() => formatNumber(current.value, decimals, compact) + suffix)
  const finalDisplay = computed(() => formatNumber(getTarget.value, decimals, compact) + suffix)

  // Резерв ширины по финальному числу знаков
  const minWidthCh = computed(() => {
    const str = formatNumber(getTarget.value, decimals, compact) + suffix
    // 0.6ch на символ — достаточно для tabular-nums
    return `${Math.max(str.length, 1) * 0.62}ch`
  })

  return { display, finalDisplay, minWidthCh }
}

/* ═══════════════════════════════════════════════════════════════
 * §2. Морфинг через View Transitions API
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Морфинг формы через View Transitions API.
 *
 * Критично: дубликат view-transition-name в документе → отказ анимации.
 * Морфинг вперёд анимированный, сброс к началу мгновенный.
 */
export function useViewMorph() {
  const supported = typeof document !== 'undefined'
    && 'startViewTransition' in document

  /**
   * Запустить переход с морфингом.
   * @param callback — функция, меняющая DOM (Vue reactive update)
   * @param instant — мгновенный сброс (без анимации)
   */
  async function morph(callback: () => void, instant = false) {
    if (!supported || instant) {
      callback()
      return
    }
    try {
      const vt = (document as any).startViewTransition(() => {
        callback()
      })
      await vt.finished
    } catch {
      // Фолбэк: просто применяем изменение
      callback()
    }
  }

  /**
   * Установить уникальное view-transition-name на элемент.
   * Снимает имя с предыдущего элемента, чтобы избежать дубликата.
   */
  const _nameMap = new Map<string, HTMLElement>()
  function setName(el: HTMLElement | null, name: string) {
    if (!el) return
    // Снимаем с предыдущего владельца
    const prev = _nameMap.get(name)
    if (prev && prev !== el) {
      prev.style.viewTransitionName = ''
    }
    el.style.viewTransitionName = name
    _nameMap.set(name, el)
  }

  function clearName(name: string) {
    const el = _nameMap.get(name)
    if (el) {
      el.style.viewTransitionName = ''
      _nameMap.delete(name)
    }
  }

  return { supported, morph, setName, clearName }
}

/* ═══════════════════════════════════════════════════════════════
 * §3. Слипающиеся заголовки
 * ═══════════════════════════════════════════════════════════════ */

export interface StickyOptions {
  /** Отступ прилипания сверху (обычно 0). */
  topOffset?: number
  /** Базовый z-index (убывает по порядку секций). */
  baseZ?: number
}

/**
 * Слипающиеся заголовки через IntersectionObserver.
 *
 * Два маркера на секцию: top (прилипание) и bottom (отлипание).
 * z-index ставится программно: baseZ - i (убывает по порядку).
 * Никаких обработчиков scroll.
 */
export function useStickyHeaders(
  scrollRef: Ref<HTMLElement | null>,
  opts: StickyOptions = {},
) {
  const { topOffset = 0, baseZ = 20 } = opts
  const stuckSections = ref<Set<string>>(new Set())
  const activeSection = ref<string | null>(null)

  let observer: IntersectionObserver | null = null
  const sectionEls = new Map<string, { header: HTMLElement; top: HTMLElement; bottom: HTMLElement }>()

  function setup() {
    const root = scrollRef.value
    if (!root) return

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const sectionId = el.closest('[data-hf-section]')?.getAttribute('data-hf-section')
          if (!sectionId) continue

          const sentinelType = el.getAttribute('data-hf-sentinel')
          if (!sentinelType) continue

          const isIntersecting = entry.isIntersecting

          if (sentinelType === 'top') {
            // Верхний маркер: если не виден → заголовок прилип
            if (!isIntersecting) {
              stuckSections.value.add(sectionId)
            } else {
              stuckSections.value.delete(sectionId)
            }
          } else if (sentinelType === 'bottom') {
            // Нижний маркер: если не виден и сверху → секция ушла
            if (!isIntersecting) {
              const rect = el.getBoundingClientRect()
              const rootRect = root.getBoundingClientRect()
              // Если нижний маркер выше верха viewport → секция уехала
              if (rect.top < rootRect.top + topOffset) {
                stuckSections.value.delete(sectionId)
              }
            }
          }
        }
        // Активная секция — последняя прилипшая
        const stuck = [...stuckSections.value]
        activeSection.value = stuck.length > 0 ? stuck[stuck.length - 1] : null

        // Обновляем Set реактивно
        stuckSections.value = new Set(stuckSections.value)
      },
      {
        root,
        threshold: 0,
        rootMargin: `-${topOffset}px 0px 0px 0px`,
      },
    )

    // Находим все секции и их маркеры
    const sections = root.querySelectorAll('[data-hf-section]')
    let i = 0
    sections.forEach((section) => {
      const id = section.getAttribute('data-hf-section')
      if (!id) return
      const header = section.querySelector('[data-hf-header]') as HTMLElement
      const topSentinel = section.querySelector('[data-hf-sentinel="top"]') as HTMLElement
      const bottomSentinel = section.querySelector('[data-hf-sentinel="bottom"]') as HTMLElement
      if (!header || !topSentinel || !bottomSentinel) return

      // z-index убывает по порядку секций
      header.style.zIndex = String(baseZ - i)
      i++

      sectionEls.set(id, { header, top: topSentinel, bottom: bottomSentinel })
      observer.observe(topSentinel)
      observer.observe(bottomSentinel)
    })
  }

  function isStuck(sectionId: string) {
    return computed(() => stuckSections.value.has(sectionId))
  }

  function scrollToSection(sectionId: string) {
    const root = scrollRef.value
    if (!root) return
    const section = root.querySelector(`[data-hf-section="${sectionId}"]`) as HTMLElement
    if (section) {
      const header = section.querySelector('[data-hf-header]') as HTMLElement
      if (header) {
        // Скроллим к началу секции с учётом sticky
        root.scrollTo({ top: section.offsetTop, behavior: 'smooth' })
      }
    }
  }

  // Отложенная инициализация
  const checkSetup = () => {
    if (scrollRef.value && !observer) setup()
  }
  // Используем watch вместо onMounted для надёжности
  watch(scrollRef, (el) => {
    if (el && !observer) {
      // Небольшая задержка для гарантии рендера дочерних элементов
      setTimeout(checkSetup, 50)
    }
  }, { immediate: true })

  onScopeDispose(() => {
    observer?.disconnect()
    observer = null
    sectionEls.clear()
  })

  return { isStuck, activeSection, scrollToSection, setup }
}

/* ═══════════════════════════════════════════════════════════════
 * §4. Адаптивное стекло
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Адаптивное стекло: реагирует на семантическую разметку плотности.
 *
 * Атрибут data-density="light|dark|mixed" на элементе под стеклом.
 * Стекло применяется только там, где под ним нет читаемого текста.
 */
export function useAdaptiveGlass() {
  const glassVariant = ref<'light' | 'dark' | 'mixed'>('light')

  function detect(el: HTMLElement | null) {
    if (!el) return
    const density = el.getAttribute('data-density')
    if (density === 'dark' || density === 'light' || density === 'mixed') {
      glassVariant.value = density
    }
  }

  return { glassVariant, detect }
}

/* ═══════════════════════════════════════════════════════════════
 * §5. Резиновая прокрутка на границах
 * ═══════════════════════════════════════════════════════════════ */

export interface RubberOptions {
  /** Максимальное смещение по вертикали. */
  maxVertical?: number
  /** Максимальное смещение по горизонтали. */
  maxHorizontal?: number
  /** Жёсткость (чем больше, тем быстрее сопротивление). */
  stiffness?: number
}

/**
 * Резиновая прокрутка: смещение на границах с экспоненциальным затуханием.
 *
 * Структура обязана быть трёхслойной:
 *   Контейнер прокрутки (overflow-y: auto)
 *   └── Обёртка резины (transform при перепрокрутке)
 *       └── Контент
 *
 * transform применяется к обёртке, не к контейнеру — иначе ломается sticky.
 */
export function useRubberScroll(
  scrollRef: Ref<HTMLElement | null>,
  wrapRef: Ref<HTMLElement | null>,
  opts: RubberOptions = {},
) {
  const { maxVertical = 32, maxHorizontal = 24, stiffness = 120 } = opts

  const offset = ref(0)
  const direction = ref<'y' | 'x'>('y')
  const isRubbering = ref(false)
  const showEndLabel = ref(false)
  const pullToRefresh = ref(false)

  const scheduler = useFrameScheduler()
  let animating = false
  let pointerActive = false
  let selectionActive = false

  const prefersReduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  function computeOffset(over: number): number {
    // Экспоненциальное затухание: порог × (1 − e^(−over/stiffness))
    const max = direction.value === 'y' ? maxVertical : maxHorizontal
    return max * (1 - Math.exp(-over / stiffness))
  }

  function applyTransform() {
    const wrap = wrapRef.value
    if (!wrap) return
    if (direction.value === 'y') {
      wrap.style.transform = `translateY(${offset.value}px)`
    } else {
      wrap.style.transform = `translateX(${offset.value}px)`
    }
  }

  function returnToZero() {
    if (offset.value === 0) return
    const from = offset.value
    const start = performance.now()
    const dur = 445 // --spring-gentle-dur

    const step = () => {
      const elapsed = performance.now() - start
      const t = Math.min(elapsed / dur, 1)
      // Пружинный возврат (упрощённый)
      const eased = 1 - Math.pow(1 - t, 3)
      offset.value = from * (1 - eased)
      applyTransform()
      if (t < 1) {
        scheduler.schedule(step)
      } else {
        offset.value = 0
        applyTransform()
        isRubbering.value = false
        showEndLabel.value = false
        pullToRefresh.value = false
        animating = false
      }
    }
    animating = true
    scheduler.schedule(step)
  }

  function onWheel(e: WheelEvent) {
    if (prefersReduced || pointerActive || selectionActive) return
    const root = scrollRef.value
    if (!root) return

    const atTop = root.scrollTop <= 0
    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight

    // Вертикальная перепрокрутка
    if (e.deltaY < 0 && atTop) {
      // Тянем вниз от верха
      if (animating) return
      const over = -e.deltaY
      offset.value = computeOffset(over)
      direction.value = 'y'
      isRubbering.value = true
      applyTransform()
      showEndLabel.value = offset.value > 12
      pullToRefresh.value = offset.value > 40
      e.preventDefault()
    } else if (e.deltaY > 0 && atBottom) {
      if (animating) return
      const over = e.deltaY
      offset.value = -computeOffset(over)
      direction.value = 'y'
      isRubbering.value = true
      applyTransform()
      showEndLabel.value = Math.abs(offset.value) > 12
      e.preventDefault()
    } else if (isRubbering.value && !animating) {
      // Возврат при нормальной прокрутке
      returnToZero()
    }
  }

  function onTouchStart() {
    if (prefersReduced) return
    pointerActive = true
    // Проверка выделения
    const sel = window.getSelection()
    selectionActive = !!sel && sel.toString().length > 0
  }

  function onTouchEnd() {
    pointerActive = false
    selectionActive = false
    if (isRubbering.value && !animating) {
      returnToZero()
    }
  }

  function onSelectionChange() {
    const sel = window.getSelection()
    selectionActive = !!sel && sel.toString().length > 0
  }

  function attach() {
    const root = scrollRef.value
    if (!root) return
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
  }

  function detach() {
    const root = scrollRef.value
    if (!root) return
    root.removeEventListener('wheel', onWheel)
    root.removeEventListener('touchstart', onTouchStart)
    root.removeEventListener('touchend', onTouchEnd)
    document.removeEventListener('selectionchange', onSelectionChange)
  }

  watch(scrollRef, (el) => {
    detach()
    if (el) {
      setTimeout(attach, 50)
    }
  }, { immediate: true })

  onScopeDispose(detach)

  return { offset, isRubbering, showEndLabel, pullToRefresh, returnToZero }
}

/* ═══════════════════════════════════════════════════════════════
 * §3.7. Тонкая полоса прогресса чтения секции
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Прогресс чтения секции — тонкая полоса внизу прилипшего заголовка.
 */
export function useSectionProgress(
  scrollRef: Ref<HTMLElement | null>,
  sectionId: string,
) {
  const progress = ref(0)
  let observing = false

  function update() {
    const root = scrollRef.value
    if (!root) return
    const section = root.querySelector(`[data-hf-section="${sectionId}"]`) as HTMLElement
    if (!section) return

    const rootRect = root.getBoundingClientRect()
    const secRect = section.getBoundingClientRect()
    const visible = secRect.top - rootRect.top
    const total = section.offsetHeight - root.clientHeight
    if (total <= 0) {
      progress.value = 0
      return
    }
    progress.value = Math.max(0, Math.min(1, -visible / total))
  }

  function attach() {
    const root = scrollRef.value
    if (!root || observing) return
    root.addEventListener('scroll', update, { passive: true })
    observing = true
    update()
  }

  function detach() {
    const root = scrollRef.value
    if (!root) return
    root.removeEventListener('scroll', update)
    observing = false
  }

  watch(scrollRef, (el) => {
    detach()
    if (el) setTimeout(attach, 50)
  }, { immediate: true })

  onScopeDispose(detach)

  return { progress }
}
