<!--
  MagneticBoard.vue — магнитная доска для перетаскивания.
  ТЗ «Фирменные детали» §6. Демонстрационная сборка + референс для PipelineView.

  Притяжение к валидным целям при dist < 12px, коэффициент 0.45.
  Невалидные цели не подсвечиваются и не притягиваются.
  Остаётся при prefers-reduced-motion (функциональность); убирается овершут.
-->
<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import {
  useMagneticDrag,
  type DropTarget,
} from '../../composables/signature'

const { activeTarget, applyMagnet, onTargetChange, reset } = useMagneticDrag()

const dragPos = ref({ x: 0, y: 0 })
const dragging = ref(false)
const boardRef = useTemplateRef<HTMLElement>('board')

const columns = [
  { id: 'new', label: 'Новые', valid: true },
  { id: 'screen', label: 'Скрининг', valid: true },
  { id: 'interview', label: 'Интервью', valid: true },
]

function onDragStart(e: PointerEvent) {
  dragging.value = true
  const target = e.target as HTMLElement
  target.setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd, { once: true })
}

function onDragMove(e: PointerEvent) {
  const board = boardRef.value
  if (!board) return
  const br = board.getBoundingClientRect()

  const targets: DropTarget[] = Array.from(
    board.querySelectorAll<HTMLElement>('[data-col]'),
  ).map((el) => {
    const r = el.getBoundingClientRect()
    return {
      id: el.dataset.col!,
      rect: { top: r.top - br.top, left: r.left - br.left, width: r.width, height: 48 },
      valid: el.dataset.valid !== 'false',
    }
  })

  const raw = { x: e.clientX - br.left - 60, y: e.clientY - br.top - 20 }
  const res = applyMagnet(raw.x, raw.y, 120, 40, targets)
  dragPos.value = { x: res.x, y: res.y }
  onTargetChange(res.targetId)
}

function onDragEnd() {
  dragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  reset()
  dragPos.value = { x: 0, y: 0 }
}
</script>

<template>
  <div ref="board" class="board">
    <div
      v-for="col in columns"
      :key="col.id"
      class="board__col"
      :class="{ 'is-target': activeTarget === col.id }"
      :data-col="col.id"
      :data-valid="col.valid"
    >
      <span class="board__col-title">{{ col.label }}</span>
    </div>

    <div
      v-if="dragging"
      class="board__card is-dragging"
      :style="{ transform: `translate(${dragPos.x}px, ${dragPos.y}px)` }"
      @pointerdown="onDragStart"
    >
      Карточка
    </div>
    <div
      v-else
      class="board__card"
      @pointerdown="onDragStart"
    >
      Карточка
    </div>
  </div>
</template>

<style scoped>
.board {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--hf-s-2);
  padding: var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface-sunken);
  min-height: 96px;
  touch-action: none;
}

.board__col {
  padding: var(--hf-s-2);
  border: 1px dashed transparent;
  border-radius: var(--hf-r-md);
  transition:
    background var(--hf-dur-instant) var(--hf-ease-out),
    border-color var(--hf-dur-instant) var(--hf-ease-out);
}

.board__col.is-target {
  border-color: var(--hf-primary);
  background: var(--hf-primary-muted);
}

.board__col-title {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
}

.board__card {
  position: absolute;
  top: var(--hf-s-2);
  left: var(--hf-s-2);
  width: 120px;
  padding: var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  font-size: var(--hf-t-sm);
  cursor: grab;
  user-select: none;
}

.board__card.is-dragging {
  z-index: 3;
  cursor: grabbing;
  box-shadow: var(--hf-shadow-lg);
  scale: 1.03;
  /* transition только на box-shadow/scale, не на transform — призрак следует мгновенно. */
  transition:
    box-shadow var(--hf-dur-fast) var(--hf-ease-out),
    scale var(--hf-dur-fast) var(--spring-bouncy);
}

@media (prefers-reduced-motion: reduce) {
  .board__card.is-dragging {
    scale: 1;
    transition: none;
  }
  /* Притяжение остаётся — это функциональность. */
}
</style>
