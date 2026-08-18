<script setup lang="ts">
/** VfGitHub — Блок. Проверка GitHub (опционально).
 *  Базовый уровень (всегда) + углублённый (только L2) + дисклеймер. */
import { computed } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useVerification } from '../../composables/useVerification'

const { github } = useVerification()

const hasDeep = computed(() => github.value.deep !== null)
</script>

<template>
  <div class="vf-gh">
    <div v-if="!github.present" class="vf-gh-none">
      <HfIcon name="github" :size="20" />
      <span>GitHub не указан</span>
    </div>

    <template v-else>
      <!-- Базовый уровень -->
      <div v-if="github.basic" class="vf-gh-section">
        <div class="vf-gh-sec-lbl">Базовый уровень</div>
        <div class="vf-gh-grid">
          <div class="vf-gh-cell">
            <span class="vf-gh-cell-num">{{ github.basic.accountAgeYears }}</span>
            <span class="vf-gh-cell-lbl">лет аккаунту</span>
          </div>
          <div class="vf-gh-cell">
            <span class="vf-gh-cell-num">{{ github.basic.publicRepos }}</span>
            <span class="vf-gh-cell-lbl">публ. репо</span>
          </div>
          <div class="vf-gh-cell">
            <span class="vf-gh-cell-num">{{ github.basic.followers }}</span>
            <span class="vf-gh-cell-lbl">подписчиков</span>
          </div>
        </div>

        <!-- Языки -->
        <div class="vf-gh-langs">
          <div v-for="l in github.basic.topLanguages" :key="l.lang" class="vf-gh-lang">
            <span class="vf-gh-lang-bar" :style="{ width: l.pct + '%' }" />
            <span class="vf-gh-lang-name">{{ l.lang }}</span>
            <span class="vf-gh-lang-pct">{{ l.pct }}%</span>
          </div>
        </div>

        <!-- Активность по годам -->
        <div class="vf-gh-activity">
          <span class="vf-gh-act-lbl">Активность по годам</span>
          <div class="vf-gh-act-bars">
            <div v-for="a in github.basic.activityByYear" :key="a.year" class="vf-gh-act-col">
              <div class="vf-gh-act-bar" :style="{ height: Math.min(100, a.commits / 7) + '%' }" />
              <span class="vf-gh-act-year">{{ String(a.year).slice(2) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Углублённый (только L2) -->
      <div v-if="hasDeep && github.deep" class="vf-gh-section vf-gh-section--deep">
        <div class="vf-gh-sec-lbl">Углублённый анализ <span class="vf-gh-l2">L2</span></div>

        <!-- Соответствие стеку -->
        <div class="vf-gh-stack">
          <div v-for="s in github.deep.stackMatch" :key="s.claimed" class="vf-gh-stack-item" :class="{ 'vf-gh-stack-item--no': !s.present }">
            <HfIcon :name="s.present ? 'check' : 'close'" :size="11" />
            <span>{{ s.claimed }}</span>
          </div>
        </div>

        <div v-if="github.deep.graphAnomaly" class="vf-gh-row vf-gh-row--warn">
          <HfIcon name="alert" :size="12" />
          <span>{{ github.deep.graphAnomaly }}</span>
        </div>

        <div class="vf-gh-qrow">
          <div class="vf-gh-qcell">
            <span class="vf-gh-qnum">{{ github.deep.contributionQuality }}</span>
            <span class="vf-gh-qlbl">качество вклада</span>
          </div>
          <div class="vf-gh-qcell">
            <span class="vf-gh-qnum">{{ github.deep.commitMeaningfulness }}</span>
            <span class="vf-gh-qlbl">осмысленность коммитов</span>
          </div>
        </div>

        <div class="vf-gh-row">
          <HfIcon name="check" :size="12" />
          <span>Временная зона: {{ github.deep.timezoneMatch ? 'совпадает' : 'расхождение' }}</span>
        </div>
        <div class="vf-gh-row">
          <HfIcon name="history" :size="12" />
          <span>{{ github.deep.dateCorrelation }}</span>
        </div>
        <div v-if="github.deep.copyDetection" class="vf-gh-row vf-gh-row--warn">
          <HfIcon name="alert" :size="12" />
          <span>{{ github.deep.copyDetection }}</span>
        </div>
      </div>
    </template>

    <!-- Обязательная оговорка -->
    <p class="vf-gh-disclaimer">
      <HfIcon name="alert" :size="12" />
      <span>{{ github.disclaimer }}</span>
    </p>
  </div>
</template>

<style scoped>
.vf-gh { display: flex; flex-direction: column; gap: var(--hf-s-3); }

.vf-gh-none { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-6); color: var(--hf-fg-subtle); font-size: var(--hf-t-sm); }

.vf-gh-section { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.vf-gh-section--deep { padding-top: var(--hf-s-3); border-top: 1px dashed var(--hf-border); }
.vf-gh-sec-lbl { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-subtle); }
.vf-gh-l2 { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: var(--hf-r-sm); background: var(--hf-primary-muted); color: var(--hf-primary); font-size: 9px; }

.vf-gh-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--hf-s-2); }
.vf-gh-cell { display: flex; flex-direction: column; gap: 1px; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); }
.vf-gh-cell-num { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-family: var(--hf-mono); }
.vf-gh-cell-lbl { font-size: 10px; color: var(--hf-fg-subtle); }

.vf-gh-langs { display: flex; flex-direction: column; gap: 2px; }
.vf-gh-lang { display: flex; align-items: center; gap: var(--hf-s-2); font-size: var(--hf-t-xs); }
.vf-gh-lang-bar { height: 8px; border-radius: var(--hf-r-sm); background: var(--hf-primary); min-width: 2px; }
.vf-gh-lang-name { color: var(--hf-fg-muted); }
.vf-gh-lang-pct { margin-left: auto; color: var(--hf-fg-subtle); font-family: var(--hf-mono); }

.vf-gh-activity { display: flex; flex-direction: column; gap: var(--hf-s-1); }
.vf-gh-act-lbl { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.vf-gh-act-bars { display: flex; align-items: flex-end; gap: var(--hf-s-2); height: 40px; }
.vf-gh-act-col { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; height: 100%; justify-content: flex-end; }
.vf-gh-act-bar { width: 100%; max-width: 24px; border-radius: var(--hf-r-sm) var(--hf-r-sm) 0 0; background: var(--hf-primary-muted); border: 1px solid var(--hf-primary); min-height: 2px; }
.vf-gh-act-year { font-size: 9px; color: var(--hf-fg-subtle); font-family: var(--hf-mono); }

.vf-gh-stack { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.vf-gh-stack-item { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: var(--hf-r-pill); background: var(--hf-match-high-muted); color: var(--hf-match-high); font-size: var(--hf-t-xs); }
.vf-gh-stack-item--no { background: var(--hf-surface-sunken); color: var(--hf-fg-subtle); }
.vf-gh-stack-item--no :deep(svg) { color: var(--hf-fg-subtle); }

.vf-gh-row { display: flex; align-items: flex-start; gap: var(--hf-s-1); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.vf-gh-row :deep(svg) { color: var(--hf-match-high); flex-shrink: 0; margin-top: 1px; }
.vf-gh-row--warn :deep(svg) { color: var(--hf-match-mid); }
.vf-gh-row--warn { color: var(--hf-match-mid); }

.vf-gh-qrow { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-2); }
.vf-gh-qcell { display: flex; flex-direction: column; gap: 1px; padding: var(--hf-s-2); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); }
.vf-gh-qnum { font-size: var(--hf-t-md); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-family: var(--hf-mono); }
.vf-gh-qlbl { font-size: 10px; color: var(--hf-fg-subtle); }

.vf-gh-disclaimer { display: flex; align-items: flex-start; gap: var(--hf-s-1); margin: 0; padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-info-muted); font-size: var(--hf-t-xs); color: var(--hf-info); line-height: var(--hf-lh-normal); }
.vf-gh-disclaimer :deep(svg) { flex-shrink: 0; margin-top: 1px; }
</style>
