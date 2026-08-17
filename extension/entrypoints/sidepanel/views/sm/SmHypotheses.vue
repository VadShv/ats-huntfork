<script setup lang="ts">
/** SmHypotheses — блок «Поисковые гипотезы» (блок 2).
 *  Чипы по 5 категориям с уровнями уверенности. Переключаемые.
 *  При раскрытии: обоснование, ожидаемый объём, риск, связанные запросы. */
import { ref, computed } from 'vue'
import HfChip from '../../ui/HfChip.vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useSearchMap, type HypothesisCategory } from '../../composables/useSearchMap'

const { hypotheses, toggleHypothesis, CONFIDENCE_META, CATEGORY_LABEL, hypothesisCountByCategory } = useSearchMap()

const categories: HypothesisCategory[] = ['titles', 'companies', 'tech', 'geo', 'indirect']
const openCat = ref<HypothesisCategory | null>('titles')
const openId = ref<string | null>(null)

function byCat(c: HypothesisCategory) {
  return hypotheses.value.filter(h => h.category === c)
}
function toggleCat(c: HypothesisCategory) {
  openCat.value = openCat.value === c ? null : c
}
function toggleExpand(id: string) {
  openId.value = openId.value === id ? null : id
}
</script>

<template>
  <div class="sm-hyp">
    <div v-for="c in categories" :key="c" class="sm-hyp-cat">
      <button class="sm-hyp-cat-head" :class="{ 'sm-hyp-cat-head--open': openCat === c }" @click="toggleCat(c)">
        <span class="sm-hyp-cat-title">{{ CATEGORY_LABEL[c] }}</span>
        <span class="sm-hyp-cat-count">{{ hypothesisCountByCategory[c] }}</span>
        <HfIcon :name="openCat === c ? 'chevron-up' : 'chevron-down'" :size="14" class="sm-hyp-cat-chev" />
      </button>

      <Transition name="sm-accordion">
        <div v-if="openCat === c" class="sm-hyp-cat-body">
          <div class="sm-hyp-chips">
            <div v-for="(h, i) in byCat(c)" :key="h.id" class="sm-hyp-chip-wrap hf-cascade" :style="{ '--hf-i': Math.min(i, 7) }">
              <button
                class="sm-hyp-chip"
                :class="{ 'sm-hyp-chip--on': h.enabled, [`sm-hyp-chip--${h.confidence}`]: h.enabled }"
                :title="h.justification"
                @click="toggleHypothesis(h.id)"
              >
                <span class="sm-hyp-chip-dot" />
                {{ h.label }}
              </button>
              <button class="sm-hyp-expand" :class="{ 'sm-hyp-expand--on': openId === h.id }" @click="toggleExpand(h.id)" :title="h.justification">
                <HfIcon name="chevron-down" :size="12" />
              </button>
            </div>
          </div>

          <Transition name="sm-accordion">
            <div v-if="openId && byCat(c).some(h => h.id === openId)" class="sm-hyp-detail">
              <template v-for="h in byCat(c)" :key="h.id">
                <div v-if="openId === h.id" class="sm-hyp-detail-grid">
                  <div class="sm-field">
                    <div class="sm-field-label">Обоснование</div>
                    <p class="sm-field-text">{{ h.justification }}</p>
                  </div>
                  <div class="sm-field">
                    <div class="sm-field-label">Ожидаемый объём</div>
                    <p class="sm-field-text">{{ h.expectedVolume }}</p>
                  </div>
                  <div class="sm-field">
                    <div class="sm-field-label sm-field-label--risk">Риск ложных срабатываний</div>
                    <p class="sm-field-text sm-field-text--risk">{{ h.falsePositiveRisk }}</p>
                  </div>
                  <div class="sm-field" v-if="h.relatedQueryIds.length">
                    <div class="sm-field-label">Связанные запросы</div>
                    <div class="sm-hyp-related">
                      <span v-for="qid in h.relatedQueryIds" :key="qid" class="sm-hyp-related-tag">{{ qid }}</span>
                    </div>
                  </div>
                  <div class="sm-field">
                    <div class="sm-field-label">Уверенность</div>
                    <HfChip :tone="CONFIDENCE_META[h.confidence].tone">{{ CONFIDENCE_META[h.confidence].label }}</HfChip>
                  </div>
                </div>
              </template>
            </div>
          </Transition>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.sm-hyp { display: flex; flex-direction: column; gap: var(--hf-s-1); }
.sm-hyp-cat { border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); overflow: hidden; background: var(--hf-surface); }
.sm-hyp-cat-head { display: flex; align-items: center; gap: var(--hf-s-2); width: 100%; padding: var(--hf-s-2) var(--hf-s-3); background: var(--hf-surface-raised); color: var(--hf-fg); font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); text-align: left; transition: background var(--hf-dur-fast) var(--hf-ease-out); }
.sm-hyp-cat-head:hover { background: var(--hf-surface-sunken); }
.sm-hyp-cat-title { flex: 1; }
.sm-hyp-cat-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 5px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); }
.sm-hyp-cat-chev { color: var(--hf-fg-subtle); }

.sm-hyp-cat-body { padding: var(--hf-s-3); border-top: 1px solid var(--hf-border); }
.sm-hyp-chips { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.sm-hyp-chip-wrap { display: inline-flex; align-items: stretch; border-radius: var(--hf-r-pill); overflow: hidden; }
.sm-hyp-chip {
  display: inline-flex; align-items: center; gap: var(--hf-s-1);
  padding: 4px var(--hf-s-2);
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-medium);
  background: var(--hf-surface-sunken); color: var(--hf-fg-subtle);
  border: 1px solid transparent;
  transition: background 90ms var(--hf-ease-out), color 90ms var(--hf-ease-out), border-color 90ms var(--hf-ease-out), transform 90ms var(--hf-ease-spring);
  cursor: pointer;
}
.sm-hyp-chip:hover { transform: translateY(-1px); }
.sm-hyp-chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.4; transition: opacity 90ms; }
.sm-hyp-chip--on { color: var(--hf-fg); background: var(--hf-surface); border-color: var(--hf-border-strong); }
.sm-hyp-chip--on .sm-hyp-chip-dot { opacity: 1; }
.sm-hyp-chip--high.sm-hyp-chip--on { background: var(--hf-match-high-muted); color: var(--hf-match-high); border-color: var(--hf-match-high); }
.sm-hyp-chip--mid.sm-hyp-chip--on { background: var(--hf-match-mid-muted); color: var(--hf-match-mid); border-color: var(--hf-match-mid); }
.sm-hyp-chip--experimental.sm-hyp-chip--on { background: var(--hf-match-low-muted); color: var(--hf-match-low); border-color: var(--hf-match-low); }

.sm-hyp-expand { display: flex; align-items: center; padding: 0 4px; background: var(--hf-surface-sunken); color: var(--hf-fg-subtle); transition: background 90ms; }
.sm-hyp-expand--on { background: var(--hf-primary-muted); color: var(--hf-primary); }
.sm-hyp-expand:hover { color: var(--hf-fg); }

.sm-hyp-detail { margin-top: var(--hf-s-3); padding: var(--hf-s-3); background: var(--hf-surface-sunken); border-radius: var(--hf-r-md); }
.sm-hyp-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-2) var(--hf-s-4); }
.sm-field { min-width: 0; }
.sm-field-label { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); margin-bottom: var(--hf-s-1); }
.sm-field-label--risk { color: var(--hf-warn); }
.sm-field-text { font-size: var(--hf-t-sm); line-height: var(--hf-lh-normal); color: var(--hf-fg); margin: 0; }
.sm-field-text--risk { color: var(--hf-warn); }
.sm-hyp-related { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.sm-hyp-related-tag { font-family: var(--hf-mono); font-size: var(--hf-t-xs); padding: 1px 6px; border-radius: var(--hf-r-sm); background: var(--hf-primary-muted); color: var(--hf-primary); }

.sm-accordion-enter-active, .sm-accordion-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out); overflow: hidden; }
.sm-accordion-enter-from, .sm-accordion-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .sm-hyp-chip-wrap { animation: none !important; } }
</style>
