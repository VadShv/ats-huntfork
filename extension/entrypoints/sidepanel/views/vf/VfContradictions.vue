<script setup lang="ts">
/** VfContradictions — Блок Б. Восемь классов противоречий.
 *  Карточки: что-vs-что, цитаты обоих фрагментов, уровень, вопрос, альтернатива. */
import HfIcon from '../../ui/HfIcon.vue'
import { useVerification } from '../../composables/useVerification'

const { contradictions } = useVerification()

const CLASS_LABEL: Record<string, string> = {
  title_vs_duties: 'Должность vs обязанности',
  grade_vs_exp: 'Грейд vs стаж',
  stack_vs_tasks: 'Стек vs задачи',
  scale_vs_role: 'Масштаб vs роль',
  geo_vs_format: 'География vs формат',
  education_vs_dates: 'Образование vs даты',
  internal: 'Внутреннее расхождение',
  cross_source: 'Между источниками',
}

const LEVEL_LABEL: Record<string, string> = {
  high: 'высокий', mid: 'средний', low: 'низкий', info: 'информационный',
}
</script>

<template>
  <div class="vf-ct">
    <div v-if="!contradictions.length" class="vf-ct-empty">
      <HfIcon name="check" :size="14" /> Противоречий не найдено
    </div>
    <div
      v-for="(c, i) in contradictions"
      :key="c.id"
      class="vf-ct-card hf-cascade"
      :class="`vf-ct-card--${c.level}`"
      :style="{ '--hf-i': Math.min(i, 7) }"
    >
      <div class="vf-ct-head">
        <span class="vf-ct-class">{{ CLASS_LABEL[c.cls] }}</span>
        <span class="vf-ct-level">{{ LEVEL_LABEL[c.level] }}</span>
      </div>
      <div class="vf-ct-title">{{ c.title }}</div>
      <div class="vf-ct-frags">
        <div class="vf-ct-frag"><span class="vf-ct-frag-tag">A</span>{{ c.fragmentA }}</div>
        <div class="vf-ct-vs">≠</div>
        <div class="vf-ct-frag"><span class="vf-ct-frag-tag">B</span>{{ c.fragmentB }}</div>
      </div>
      <div class="vf-ct-q">
        <HfIcon name="help" :size="12" />
        <span>{{ c.suggestedQuestion }}</span>
      </div>
      <div class="vf-ct-alt">
        <HfIcon name="history" :size="11" />
        <span>Альтернатива: {{ c.alternativeExplanation }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vf-ct { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.vf-ct-empty { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-3); color: var(--hf-fg-muted); font-size: var(--hf-t-sm); }

.vf-ct-card { border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface); padding: var(--hf-s-3); border-left-width: 3px; }
.vf-ct-card--high { border-left-color: var(--hf-match-low); }
.vf-ct-card--mid { border-left-color: var(--hf-match-mid); }
.vf-ct-card--low { border-left-color: var(--hf-fg-subtle); }
.vf-ct-card--info { border-left-color: var(--hf-info); }

.vf-ct-head { display: flex; align-items: center; gap: var(--hf-s-2); margin-bottom: var(--hf-s-1); }
.vf-ct-class { font-size: var(--hf-t-xs); padding: 1px 7px; border-radius: var(--hf-r-pill); background: var(--hf-primary-muted); color: var(--hf-primary); font-weight: var(--hf-fw-semibold); }
.vf-ct-level { margin-left: auto; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.vf-ct-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); margin-bottom: var(--hf-s-2); }

.vf-ct-frags { display: flex; flex-direction: column; gap: 2px; margin-bottom: var(--hf-s-2); }
.vf-ct-frag { display: flex; align-items: flex-start; gap: var(--hf-s-2); padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); background: var(--hf-surface-sunken); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.vf-ct-frag-tag { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: var(--hf-r-sm); background: var(--hf-border-strong); color: var(--hf-surface); font-size: 9px; font-weight: var(--hf-fw-bold); flex-shrink: 0; }
.vf-ct-vs { text-align: center; font-size: var(--hf-t-xs); color: var(--hf-match-mid); font-weight: var(--hf-fw-bold); }

.vf-ct-q { display: flex; align-items: flex-start; gap: var(--hf-s-1); padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); background: var(--hf-info-muted); color: var(--hf-info); font-size: var(--hf-t-xs); margin-bottom: var(--hf-s-1); }
.vf-ct-alt { display: flex; align-items: flex-start; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }

@media (prefers-reduced-motion: reduce) { .vf-ct-card { animation: none !important; } }
</style>
