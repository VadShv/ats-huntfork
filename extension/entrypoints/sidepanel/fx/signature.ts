/**
 * signature.ts — фирменные детали Huntfork Sidekick (7 штук).
 * ТЗ «Фирменные детали интерфейса» §1–§7.
 *
 * Все анимации на setTimeout — rAF не срабатывает в CDP-controlled sidepanel.
 * Ни одна деталь не несёт эксклюзивной информации; всё гаснет по
 * prefers-reduced-motion (кроме магнитного прилипания — оно функционально).
 */

import { ref, computed, watch, onScopeDispose, type Ref } from 'vue'

/* ════════════════════════════════════════════════════════════════
 * 0. Базовая инфраструктура
 * ════════════════════════════════════════════════════════════════ */

/**
 * Планировщик кадров на setTimeout.
 * Замена requestAnimationFrame — отменяет предыдущий таймер перед
 * постановкой нового, даёт дебаунс при потоке pointermove.
 * В sidepanel rAF не срабатывает на фоне; setTimeout надёжнее.
 */
export function useFrameScheduler(): {
  schedule: (fn: () => void) => void
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  const FRAME = 16 // ~60fps

  function schedule(fn: () => void): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, FRAME)
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { schedule, cancel }
}

/**
 * Аварийный выключатель и медиа-запросы.
 * Проверяет: prefers-reduced-motion, hover: none, .hf-no-flourish на корне.
 */
export function flourishEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const root = document.documentElement
  if (root.classList.contains('hf-no-flourish')) return false

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (motion.matches) return false

  const hover = window.matchMedia('(hover: none)')
  if (hover.matches) {
    // hover:none не полностью глушит всё — только зрачки и спекуляр.
    // Но flourishEnabled используется для чисто декоративных деталей.
    return false
  }

  return true
}

/** Проверка только reduced-motion (для деталей, где hover не важен). */
export function motionEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ════════════════════════════════════════════════════════════════
 * 1. Тепловая карта карьеры — функция расчёта цвета
 * ════════════════════════════════════════════════════════════════ */

const LN3 = Math.log(3)
const LN60 = Math.log(60)

/**
 * Логарифмическая нормализация длительности в heat [0..1].
 * 1 = тревожно (короткий срок), 0 = спокойно (долгий).
 * Диапазон обрезается: <3 мес → 1.0, >60 мес → 0.0.
 */
export function heatFromMonths(months: number): number {
  if (months <= 3) return 1
  if (months >= 60) return 0
  const heat = 1 - (Math.log(months) - LN3) / (LN60 - LN3)
  return Math.max(0, Math.min(1, heat))
}

/**
* Цвет полосы по heat через OKLCH-интерполяцию.
 * Монохромная шкаала: цвет заменён светлотой (миграция §2).
 * Тревожно = тёмный, спокойно = светлый. Хрома 0.003 (правило §6).
 */
export function heatColor(months: number): string {
  const heat = heatFromMonths(months)
  const l = 0.82 - 0.70 * heat
  return `oklch(${l.toFixed(3)} 0.003 265)`
}
export function heatHatch(months: number): number {
  const heat = heatFromMonths(months)
  return Math.round(10 - 7 * heat)
}

/** Текстовая метка для легенды по heat. */
export function heatLabel(months: number): string {
  const heat = heatFromMonths(months)
  if (heat >= 0.85) return 'Тревожно'
  if (heat >= 0.6) return 'Настораживает'
  if (heat >= 0.4) return 'Нейтрально'
  if (heat >= 0.15) return 'Спокойно'
  if (heat >= 0.05) return 'Основательно'
  return 'Якорь карьеры'
}

/* ════════════════════════════════════════════════════════════════
 * 2. Волки, следящие за курсором
 * ════════════════════════════════════════════════════════════════ */

/**
 * useWolfEyes — слежение зрачков зажжённых волков за курсором.
 * Работает только при hover (pointermove), зрачки отстают на 120мс.
 * Моргание раз в 6–10с, только при visibilityState === 'visible'.
 *
 * @param host Ref на элемент-контейнер шкалы волков.
 */
export function useWolfEyes(host: Ref<HTMLElement | null>) {
  const eyeStyle = ref<Record<string, string>>({})
  const blinking = ref<Set<number>>(new Set())

  const scheduler = useFrameScheduler()
  let blinkTimer: ReturnType<typeof setTimeout> | null = null
  let active = false

  function activate(): void {
    if (active || !host.value) return
    active = true
    host.value.addEventListener('pointermove', onMove, { passive: true })
    host.value.addEventListener('pointerleave', onLeave)
    scheduleBlink()
  }

  function deactivate(): void {
    if (!active) return
    active = false
    host.value?.removeEventListener('pointermove', onMove)
    host.value?.removeEventListener('pointerleave', onLeave)
    scheduler.cancel()
    if (blinkTimer !== null) {
      clearTimeout(blinkTimer)
      blinkTimer = null
    }
    eyeStyle.value = {}
  }

  function onMove(e: PointerEvent): void {
    if (!flourishEnabled() || !host.value) return
    const el = host.value
    scheduler.schedule(() => {
      const pupils = el.querySelectorAll<HTMLElement>('.wolf__pupil.is-lit')
      const style: Record<string, string> = {}
      pupils.forEach((pupil) => {
        const r = pupil.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const dx = e.clientX - cx
        const dy = e.clientY - cy
        const dist = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)
        const radius = Math.min(2.2, dist / 40)
        const ox = Math.cos(angle) * radius
        const oy = Math.sin(angle) * radius
        // Ключ по data-eye для точечного применения
        const key = pupil.dataset.eye || '0'
        style[key] = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`
      })
      eyeStyle.value = style
    })
  }

  function onLeave(): void {
    scheduler.schedule(() => {
      eyeStyle.value = {}
    })
  }

  function scheduleBlink(): void {
    if (!active) return
    const delay = 6000 + Math.random() * 4000
    blinkTimer = setTimeout(() => {
      if (document.visibilityState === 'visible' && host.value) {
        const lit = Array.from(
          host.value.querySelectorAll<HTMLElement>('.wolf__pupil.is-lit'),
        )
        if (lit.length) {
          const target = lit[Math.floor(Math.random() * lit.length)]
          const eye = target.dataset.eye || '0'
          blinking.value = new Set([...blinking.value, eye])
          setTimeout(() => {
            const next = new Set(blinking.value)
            next.delete(eye)
            blinking.value = next
          }, 90)
        }
      }
      scheduleBlink()
    }, delay)
  }

  onScopeDispose(deactivate)

  return { eyeStyle, blinking, activate, deactivate }
}

/* ════════════════════════════════════════════════════════════════
 * 3. След лапы вместо спиннера
 * ════════════════════════════════════════════════════════════════ */

/**
 * usePawTrail — генерирует массив отпечатков для цепочки лап.
 * Анимация полностью на CSS; композабл только даёт данные для рендера.
 *
 * @param count Количество отпечатков (по умолчанию 5).
 */
export function usePawTrail(count = 5) {
  const steps = computed(() =>
    Array.from({ length: count }, (_, i) => ({
      index: i,
      offset: i % 2 === 0 ? -2 : 2, // ±2px имитация походки
      opacity: 0.25 + (0.75 * (i + 1)) / count, // от хвоста к голове
      delay: i * 90, // ms
    })),
  )
  return { steps }
}

/* ════════════════════════════════════════════════════════════════
 * 4. Компас карты поиска
 * ════════════════════════════════════════════════════════════════ */

export interface CompassSection {
  id: string
  label: string
  unseenRatio: number // 0..1
  confidence: number // 0..1
  historicalSuccess: number // 0..1
}

/**
 * useSearchCompass — вычисляет угол стрелки компаса.
 * potential = 0.4·unseen + 0.3·confidence + 0.3·historical.
 * Угол = позиция секции на круге.
 */
export function useSearchCompass(sections: Ref<CompassSection[]>) {
  const angle = computed(() => {
    if (!sections.value.length) return 0
    const n = sections.value.length
    let bestIdx = 0
    let bestPot = -1
    sections.value.forEach((s, i) => {
      const pot =
        0.4 * s.unseenRatio + 0.3 * s.confidence + 0.3 * s.historicalSuccess
      if (pot > bestPot) {
        bestPot = pot
        bestIdx = i
      }
    })
    const step = 360 / n
    return bestIdx * step
  })

  const label = computed(() => {
    if (!sections.value.length) return ''
    const n = sections.value.length
    let bestIdx = 0
    let bestPot = -1
    sections.value.forEach((s, i) => {
      const pot =
        0.4 * s.unseenRatio + 0.3 * s.confidence + 0.3 * s.historicalSuccess
      if (pot > bestPot) {
        bestPot = pot
        bestIdx = i
      }
    })
    return `Наибольший потенциал: ${sections.value[bestIdx].label}`
  })

  const hasData = computed(() => sections.value.length > 0)

  return { angle, label, hasData }
}

/* ════════════════════════════════════════════════════════════════
 * 5. Печатная машинка
 * ════════════════════════════════════════════════════════════════ */

/** Глобальное множество уже набранных id — состояние живёт между монтированиями. */
const typedSet = new Set<string>()

const TYPE_BASE = 22 // ms на символ
const TYPE_JITTER = 6 // ±ms
const TYPE_CAP = 1800 // потолок 1.8с
const QUESTION_PAUSE = 200 // пауза между вопросами

/**
 * useTypewriter — печатная машинка для текста.
 * Высота резервируется заранее (через min-height в компоненте).
 * Скринридер получает полный текст сразу (в компоненте через .hf-sr),
 * анимируется только визуальный слой.
 *
 * @param idFn Геттер уникального id (для дедупликации — не повторять).
 * @param textFn Геттер полного текста.
 */
export function useTypewriter(idFn: () => string, textFn: () => string) {
  const shown = ref('')
  const typing = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let charIdx = 0

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function typeNext(): void {
    const text = textFn()
    if (charIdx >= text.length) {
      typing.value = false
      shown.value = text
      return
    }
    shown.value = text.slice(0, charIdx + 1)
    charIdx++
    // Джиттер ±6мс, но скорость растёт для длинного текста чтобы уложиться в потолок.
    const remaining = text.length - charIdx
    const remainingBudget = TYPE_CAP - (charIdx * TYPE_BASE)
    let delay = TYPE_BASE + (Math.random() * 2 - 1) * TYPE_JITTER
    if (remainingBudget < remaining * TYPE_BASE) {
      // Не успеваем — ускоряемся пропорционально.
      delay = Math.max(8, remainingBudget / remaining)
    }
    timer = setTimeout(typeNext, delay)
  }

  function start(): void {
    clearTimer()
    const id = idFn()
    const text = textFn()
    // Уже набирался — показываем целиком без анимации.
    if (typedSet.has(id) || !motionEnabled()) {
      shown.value = text
      typing.value = false
      return
    }
    typedSet.add(id)
    charIdx = 0
    shown.value = ''
    typing.value = true
    timer = setTimeout(typeNext, TYPE_BASE)
  }

  /** Пропустить анимацию — показать весь текст сразу. */
  function skip(): void {
    clearTimer()
    shown.value = textFn()
    typing.value = false
    charIdx = textFn().length
  }

  /** Прервать любым взаимодействием. */
  function interrupt(): void {
    if (typing.value) skip()
  }

  watch(
    [idFn, textFn],
    () => start(),
    { immediate: true },
  )

  onScopeDispose(clearTimer)

  return { shown, typing, skip, interrupt, start }
}

/* ════════════════════════════════════════════════════════════════
 * 6. Магнитное прилипание при перетаскивании
 * ════════════════════════════════════════════════════════════════ */

export interface DropTarget {
  id: string
  rect: { top: number; left: number; width: number; height: number }
  valid: boolean
}

const MAGNET_THRESHOLD = 12 // px
const MAGNET_COEFF = 0.45

/**
 * useMagneticDrag — магнитное притяжение карточки к валидным целям.
 * Коэффициент 0.45 — ощущается как точность, не отбирает контроль.
 * Притяжение только к валидным целям; невалидные не подсвечиваются.
 * Остаётся при prefers-reduced-motion (функциональность); убирается овершут.
 */
export function useMagneticDrag() {
  const activeTarget = ref<string | null>(null)
  let lastBuzz: string | null = null

  /**
   * applyMagnet — рассчитывает смещение с магнитным притяжением.
   * @param x Текущая X позиции карточки (relative to board).
   * @param y Текущая Y.
   * @param cardW Ширина карточки.
   * @param cardH Высота.
   * @paramTargets Массив целей.
   * @returns { x, y, targetId } — новая позиция и id захваченной цели.
   */
  function applyMagnet(
    x: number,
    y: number,
    cardW: number,
    cardH: number,
    targets: DropTarget[],
  ): { x: number; y: number; targetId: string | null } {
    let targetId: string | null = null
    let bestDist = MAGNET_THRESHOLD

    for (const t of targets) {
      if (!t.valid) continue // невалидные — не подсвечиваем, не притягиваем

      const targetCx = t.rect.left + t.rect.width / 2
      const targetCy = t.rect.top + t.rect.height / 2
      const cardCx = x + cardW / 2
      const cardCy = y + cardH / 2
      const dist = Math.hypot(targetCx - cardCx, targetCy - cardCy)

      if (dist < bestDist) {
        bestDist = dist
        targetId = t.id
      }
    }

    let resultX = x
    let resultY = y

    if (targetId) {
      const t = targets.find((tt) => tt.id === targetId)!
      const targetCx = t.rect.left + t.rect.width / 2
      const targetCy = t.rect.top + t.rect.height / 2
      const cardCx = x + cardW / 2
      const cardCy = y + cardH / 2
      const force = 1 - bestDist / MAGNET_THRESHOLD
      const dx = (targetCx - cardCx) * force * MAGNET_COEFF
      const dy = (targetCy - cardCy) * force * MAGNET_COEFF
      resultX = x + dx
      resultY = y + dy
    }

    // Вибрация один раз при входе в новую зону.
    if (targetId !== lastBuzz) {
      lastBuzz = targetId
      if (targetId && navigator.vibrate) navigator.vibrate(8)
    }

    return { x: resultX, y: resultY, targetId }
  }

  /** Колбэк изменения цели — обновляет activeTarget для подсветки. */
  function onTargetChange(id: string | null): void {
    activeTarget.value = id
  }

  function reset(): void {
    activeTarget.value = null
    lastBuzz = null
  }

  return { activeTarget, applyMagnet, onTargetChange, reset }
}

/* ════════════════════════════════════════════════════════════════
 * 7. Инерция закрытия панели
 * ════════════════════════════════════════════════════════════════ */

export type InertiaKind = 'panel' | 'popover' | 'toast' | 'modal'

const INERTIA_CONFIG: Record<
  InertiaKind,
  { kick: number; closeDur: string; axis: 'x' | 'y' | 'z' }
> = {
  panel: { kick: 3, closeDur: '260ms', axis: 'x' },
  popover: { kick: 1.5, closeDur: '180ms', axis: 'x' },
  toast: { kick: 0, closeDur: '220ms', axis: 'y' },
  modal: { kick: 1.5, closeDur: '240ms', axis: 'z' },
}

/**
 * useInertialClose — инерция закрытия с микро-замахом.
 * Фокус возвращается на элемент-инициатор СРАЗУ, до анимации.
 * prefers-reduced-motion — мгновенное скрытие.
 *
 * @param kind Тип элемента: panel/popover/toast/modal.
 */
export function useInertialClose(kind: InertiaKind = 'panel') {
  const closing = ref(false)
  const config = INERTIA_CONFIG[kind]

  const style = computed(() => ({
    '--hf-kick': `${config.kick}px`,
    '--hf-close-dur': config.closeDur,
  }))

  let savedFocus: HTMLElement | null = null

  /**
   * close — запускает инерционное закрытие.
   * @param onComplete Вызывается после анимации (скрытие v-if).
   * @param restoreFocus Функция возврата фокуса (вызывается ПЕРВОЙ).
   */
  function close(onComplete: () => void, restoreFocus?: () => void): void {
    // Фокус возвращается ДО анимации — иначе эффект становится проблемой a11y.
    restoreFocus?.()

    if (!motionEnabled()) {
      onComplete()
      return
    }

    closing.value = true
    const dur = parseInt(config.closeDur)
    setTimeout(() => {
      closing.value = false
      onComplete()
    }, dur)
  }

  /** Сохранить элемент для возврата фокуса. */
  function saveFocus(el: HTMLElement | null): void {
    savedFocus = el
  }

  /** Вернуть фокус на сохранённый элемент. */
  function restoreSavedFocus(): void {
    savedFocus?.focus?.()
  }

  return { closing, close, style, saveFocus, restoreSavedFocus }
}
