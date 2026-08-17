/**
 * useTabIndicator — переезжающий индикатор активной вкладки.
 *
 * Решает четыре проблемы, на которых обычно ломаются самодельные индикаторы:
 *   1. ResizeObserver loop  → запись отложена в requestAnimationFrame
 *   2. Скачок при монтировании → первая установка без transition
 *   3. Рассинхрон при смене шрифта → await document.fonts.ready
 *   4. Утечка наблюдателей   → полная очистка в onScopeDispose
 */
import {
  ref, watch, onMounted, onScopeDispose, computed,
  type Ref, type MaybeRefOrGetter, toValue,
} from 'vue'

export interface TabIndicatorOptions {
  /** 'vertical' — рельс Sidekick, 'horizontal' — обычные табы. */
  orientation?: 'vertical' | 'horizontal'
  /** Доля длины элемента, которую занимает индикатор. 1 = во всю длину. */
  ratio?: number
  /** Селектор активного элемента внутри контейнера. */
  activeSelector?: string
}

export function useTabIndicator(
  containerRef: Ref<HTMLElement | null | undefined>,
  activeKey: MaybeRefOrGetter<string | number>,
  options: TabIndicatorOptions = {},
) {
  const {
    orientation = 'vertical',
    ratio = 0.6,
    activeSelector = '[data-active="true"]',
  } = options

  const offset = ref(0)
  const size = ref(0)
  /** false до первого измерения — гасим индикатор, чтобы не мигал в нуле. */
  const ready = ref(false)
  /** На первом кадре отключаем transition, иначе индикатор «прилетает» из угла. */
  const animated = ref(false)

  let frame = 0

  function measure() {
    const root = containerRef.value
    if (!root) return

    const el = root.querySelector<HTMLElement>(activeSelector)
    if (!el) return

    /* offsetTop/offsetLeft вместо getBoundingClientRect: они уже относительны
       позиционированному родителю, поэтому не зависят от скролла контейнера
       и не требуют вычитания rect'а рельса. */
    const full = orientation === 'vertical' ? el.offsetHeight : el.offsetWidth
    const start = orientation === 'vertical' ? el.offsetTop : el.offsetLeft

    size.value = full * ratio
    offset.value = start + (full * (1 - ratio)) / 2
    ready.value = true
  }

  /**
  * Перенос записи в rAF — выносит её за пределы ResizeObserver-цикла.
  */
 function schedule() {
   cancelAnimationFrame(frame)
   // setTimeout вместо rAF: в side panel через CDP rAF throttлится/не стреляет,
   // когда страница считается «не видимой». setTimeout надёжен всегда.
   frame = window.setTimeout(measure, 16) as unknown as number
 }

  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null

  onMounted(async () => {
    measure()
    // setTimeout вместо rAF (см. примечание в schedule).
    setTimeout(() => { animated.value = true }, 16)

    if (document.fonts?.ready) {
      await document.fonts.ready
      schedule()
    }

    const root = containerRef.value
    if (!root) return

    ro = new ResizeObserver(schedule)
    ro.observe(root)
    for (const child of Array.from(root.children)) ro.observe(child)

    mo = new MutationObserver(schedule)
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active', 'class'] })
  })

  // flush:'post' — гарантируем, что DOM уже обновлён классом активной вкладки
  // к моменту измерения; иначе querySelector найдёт старый активный элемент.
  watch(() => toValue(activeKey), schedule, { flush: 'post' })

  onScopeDispose(() => {
    cancelAnimationFrame(frame as number)
    clearTimeout(frame as number)
    ro?.disconnect()
    mo?.disconnect()
  })

  /** Готовый объект для :style. */
  const style = computed(() => ({
    transform: orientation === 'vertical'
      ? `translate3d(0, ${offset.value}px, 0)`
      : `translate3d(${offset.value}px, 0, 0)`,
    [orientation === 'vertical' ? 'height' : 'width']: `${size.value}px`,
    opacity: ready.value ? 1 : 0,
    transitionDuration: animated.value ? '' : '0ms',
  }))

  return { style, offset, size, ready, remeasure: schedule }
}
