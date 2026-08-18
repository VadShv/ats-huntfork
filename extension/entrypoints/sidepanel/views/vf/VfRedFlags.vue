<script setup lang="ts">
/** VfRedFlags — Блок Д. Топ-3 ред-флага.
 *  Ровно 3 с наибольшим весом, остальные в развёрнутом списке.
 *  У каждого: заголовок, суть, доказательство с цитатами, уровень,
 *  альтернативное объяснение (обязательно), связанные вопросы. */
import { ref } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useVerification } from '../../composables/useVerification'

const { top3, questions } = useVerification()
const showExtra = ref(false)

const LEVEL_LABEL: Record<string, string> = {
  high: 'высокий', mid: 'средний', low: 'низкий', info: 'информационный',
}

function questionsFor(ids: string[]) {
  return questions.value.filter(q => ids.includes(q.id))
}
</script>

<template>
  <div class="vf-rf">
    <div v-if="!top3.top.length" class="vf-rf-clean">
      <HfIcon name="check" :size="16" />
      <span>Существенных расхождений не найдено</span>
    </div>

    <!-- Топ-3 -->
    <div
      v-for="(f, i) in top3.top"
      :key="f.id"
      class="vf-rf-card hf-cascade"
      :class="`vf-rf-card--${f.level}`"
      :style="{ '--hf-i': Math.min(i, 7) }"
    >
      <div class="vf-rf-rank">{{ i + 1 }}</div>
      <div class="vf-rf-body">
        <div class="vf-rf-head">
          <span class="vf-rf-title">{{ f.title }}</span>
          <span class="vf-rf-level">{{ LEVEL_LABEL[f.level] }}</span>
        </div>
        <p class="vf-rf-summary">{{ f.summary }}</p>
        <div class="vf-rf-evidence">
          <HfIcon name="clipboard-check" :size="11" />
          <span>{{ f.evidence }}</span>
        </div>
        <div class="vf-rf-alt">
          <HfIcon name="history" :size="11" />
          <span>Альтернатива: {{ f.alternativeExplanation }}</span>
        </div>
        <div v-if="questionsFor(f.questionIds).length" class="vf-rf-qlinks">
          <span class="vf-rf-qlinks-lbl">Вопросы:</span>
          <span v-for="q in questionsFor(f.questionIds)" :key="q.id" class="vf-rf-qlink">
            <span class="vf-rf-qlink-m">{{ q.method }}</span>{{ q.text }}
          </span>
        </div>
      </div>
    </div>

    <!-- Остальные -->
    <div v-if="top3.extra.length" class="vf-rf-extra">
      <button class="vf-rf-extra-btn" @click="showExtra = !showExtra">
        <HfIcon name="chevron-down" :size="12" :class="{ 'vf-rf-chev--open': showExtra }" />
        Ещё {{ top3.extra.length }} {{ top3.extra.length === 1 ? 'находка' : 'находок' }}
      </button>
      <Transition name="vf-grid">
        <div v-if="showExtra" class="vf-rf-extra-list">
          <div v-for="f in top3.extra" :key="f.id" class="vf-rf-extra-item" :class="`vf-rf-extra-item--${f.level}`">
            <span class="vf-rf-extra-title">{{ f.title }}</span>
            <span class="vf-rf-extra-level">{{ LEVEL_LABEL[f.level] }}</span>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.vf-rf { display: flex; flex-direction: column; gap: var(--hf-s-2); }

.vf-rf-clean { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-4); color: var(--hf-match-high); font-size: var(--hf-t-sm); }

.vf-rf-card { display: grid; grid-template-columns: 24px 1fr; gap: var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface); padding: var(--hf-s-3); border-left-width: 3px; }
.vf-rf-card--high { border-left-color: var(--hf-match-low); }
.vf-rf-card--mid { border-left-color: var(--hf-match-mid); }
.vf-rf-card--low { border-left-color: var(--hf-fg-subtle); }
.vf-rf-card--info { border-left-color: var(--hf-info); }

.vf-rf-rank { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--hf-r-sm); background: var(--hf-primary-muted); color: var(--hf-primary); font-size: var(--hf-t-sm); font-weight: var(--hf-fw-bold); font-family: var(--hf-mono); }
.vf-rf-body { display: flex; flex-direction: column; gap: var(--hf-s-1); min-width: 0; }
.vf-rf-head { display: flex; align-items: flex-start; gap: var(--hf-s-2); }
.vf-rf-title { flex: 1; font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.vf-rf-level { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); white-space: nowrap; }
.vf-rf-summary { margin: 0; font-size: var(--hf-t-sm); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }
.vf-rf-evidence { display: flex; align-items: flex-start; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); font-family: var(--hf-mono); }
.vf-rf-alt { display: flex; align-items: flex-start; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-info); }

.vf-rf-qlinks { display: flex; flex-direction: column; gap: 2px; margin-top: var(--hf-s-1); padding-top: var(--hf-s-1); border-top: 1px dashed var(--hf-border); }
.vf-rf-qlinks-lbl { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); text-transform: uppercase; letter-spacing: 0.03em; }
.vf-rf-qlink { display: flex; align-items: flex-start; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.vf-rf-qlink-m { display: inline-block; padding: 0 4px; border-radius: var(--hf-r-sm); background: var(--hf-primary-muted); color: var(--hf-primary); font-size: 9px; font-weight: var(--hf-fw-bold); flex-shrink: 0; }

.vf-rf-extra { margin-top: var(--hf-s-1); }
.vf-rf-extra-btn { display: flex; align-items: center; gap: var(--hf-s-1); padding: var(--hf-s-1) var(--hf-s-2); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); background: none; }
.vf-rf-chev--open { transform: rotate(180deg); }
.vf-rf-extra-list { display: flex; flex-direction: column; gap: 2px; margin-top: var(--hf-s-1); }
.vf-rf-extra-item { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); background: var(--hf-surface-sunken); font-size: var(--hf-t-xs); border-left: 2px solid; }
.vf-rf-extra-item--high { border-left-color: var(--hf-match-low); }
.vf-rf-extra-item--mid { border-left-color: var(--hf-match-mid); }
.vf-rf-extra-item--low { border-left-color: var(--hf-fg-subtle); }
.vf-rf-extra-item--info { border-left-color: var(--hf-info); }
.vf-rf-extra-title { flex: 1; color: var(--hf-fg-muted); }
.vf-rf-extra-level { color: var(--hf-fg-subtle); }

.vf-grid-enter-active, .vf-grid-leave-active { transition: opacity var(--hf-dur-base) var(--hf-ease-out); overflow: hidden; }
.vf-grid-enter-from, .vf-grid-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) { .vf-rf-card { animation: none !important; } }
</style>
