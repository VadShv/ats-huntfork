<script setup lang="ts">
/** ProfileDiff — блок «что изменилось» с прошлого раза.
 *  + зелёный (added), → жёлтый (changed), − серый зачёркнутый (removed). */
import { useDiff } from '../composables/useDiff'
import HfIcon from '../ui/HfIcon.vue'

const { diff } = useDiff()
</script>

<template>
  <Transition name="diff-in">
    <section v-if="diff.visible" class="profile-diff">
      <header class="diff-head">
        <HfIcon name="refresh" :size="16" />
        <span class="diff-title">Изменения профиля</span>
        <span v-if="diff.lastSeen" class="diff-last">с {{ diff.lastSeen }}</span>
      </header>

      <ul class="diff-list">
        <li
          v-for="(f, i) in diff.fields"
          :key="i"
          class="diff-row"
          :class="`diff-row--${f.status}`"
          :style="{ '--hf-i': i }"
        >
          <span class="diff-label">{{ f.label }}</span>
          <span class="diff-values">
            <span v-if="f.oldValue" class="diff-old">{{ f.oldValue }}</span>
            <span v-if="f.status === 'changed'" class="diff-arrow">→</span>
            <span v-if="f.newValue" class="diff-new">{{ f.newValue }}</span>
          </span>
        </li>
      </ul>
    </section>
  </Transition>
</template>

<style scoped>
.profile-diff {
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  padding: var(--hf-s-3);
  margin-bottom: var(--hf-s-4);
  background: var(--hf-surface-raised);
}
.diff-head {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  margin-bottom: var(--hf-s-3);
  color: var(--hf-fg-muted);
}
.diff-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); }
.diff-last { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); margin-left: auto; }

.diff-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--hf-s-2); }
.diff-row {
  display: flex;
  align-items: baseline;
  gap: var(--hf-s-2);
  font-size: var(--hf-t-sm);
  animation: hf-card-in var(--hf-dur-base) var(--hf-ease-out) both;
  animation-delay: calc(var(--hf-i, 0) * 35ms);
}
.diff-label {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-subtle);
  min-width: 100px;
  flex-shrink: 0;
}
.diff-values { display: flex; align-items: baseline; gap: var(--hf-s-1); flex-wrap: wrap; }

.diff-old { color: var(--hf-fg-subtle); text-decoration: line-through; }
.diff-new { color: var(--hf-fg); font-weight: var(--hf-fw-medium); }
.diff-arrow { color: var(--hf-warn); font-size: var(--hf-t-xs); }

.diff-row--added .diff-new { color: var(--hf-ok); }
.diff-row--added::before { content: '+'; color: var(--hf-ok); font-weight: bold; width: 12px; flex-shrink: 0; }
.diff-row--changed::before { content: '→'; color: var(--hf-warn); font-weight: bold; width: 12px; flex-shrink: 0; }
.diff-row--removed::before { content: '−'; color: var(--hf-fg-subtle); font-weight: bold; width: 12px; flex-shrink: 0; }
.diff-row--removed .diff-old { color: var(--hf-fg-subtle); }
.diff-row--same::before { content: '='; color: var(--hf-fg-subtle); width: 12px; flex-shrink: 0; }
.diff-row--same { opacity: 0.6; }

.diff-in-enter-active, .diff-in-leave-active {
  transition: opacity var(--hf-dur-base) var(--hf-ease-out), transform var(--hf-dur-base) var(--hf-ease-out);
}
.diff-in-enter-from, .diff-in-leave-to { opacity: 0; transform: translateY(6px); }

@media (prefers-reduced-motion: reduce) {
  .diff-row { animation: none !important; }
}
</style>
