<script setup lang="ts">
/**
 * Карточка-обёртка с цветной match-полоской слева и каскадной анимацией.
 * match: 0–100 → низкая/средняя/высокая шкала соответствия.
 */
import { useSpecular } from '../composables/useSpecular'

withDefaults(defineProps<{
  match?: number | null
  index?: number
  title?: string
  subtitle?: string
}>(), { match: null, index: 0, title: '', subtitle: '' })

function tone(p: number | null): string {
  if (p == null) return ''
  if (p >= 70) return 'high'
  if (p >= 40) return 'mid'
  return 'low'
}

const { onMove, bind } = useSpecular()
</script>

<template>
 <article
    class="hf-card hf-cascade"
   ref="bind"
    :class="match != null ? `hf-card--${tone(match)}` : ''"
    :style="{ '--hf-i': index }"
    @mousemove="onMove"
  >
    <span v-if="match != null" class="hf-card-strip" />
    <header v-if="title || $slots.header" class="hf-card-head">
      <slot name="header">
        <div class="hf-card-titles">
          <h3 v-if="title" class="hf-card-title">{{ title }}</h3>
          <p v-if="subtitle" class="hf-card-sub">{{ subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots.meta" class="hf-card-meta"><slot name="meta" /></div>
    </header>
    <div class="hf-card-body"><slot /></div>
    <footer v-if="$slots.footer" class="hf-card-foot"><slot name="footer" /></footer>
  </article>
</template>

<script lang="ts">
export default { name: 'HfCard' }
</script>

<style scoped>
.hf-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-3);
  padding: var(--hf-s-4);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  overflow: hidden;
  transition: transform var(--hf-dur-fast) var(--hf-ease-out),
              box-shadow var(--hf-dur-fast) var(--hf-ease-out),
              border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.hf-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--hf-shadow-md);
  border-color: var(--hf-border-strong);
}

/* Цветная match-полоска */
.hf-card-strip {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
}
.hf-card--high .hf-card-strip { background: var(--hf-match-high); }
.hf-card--mid  .hf-card-strip { background: var(--hf-match-mid); }
.hf-card--low  .hf-card-strip { background: var(--hf-match-low); }

.hf-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--hf-s-2);
}
.hf-card-titles { min-width: 0; }
.hf-card-title {
  font-size: var(--hf-t-md);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg);
  line-height: var(--hf-lh-tight);
}
.hf-card-sub {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hf-card-meta { flex-shrink: 0; }
.hf-card-body { font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: var(--hf-lh-normal); }
.hf-card-foot { display: flex; gap: var(--hf-s-2); }
</style>
