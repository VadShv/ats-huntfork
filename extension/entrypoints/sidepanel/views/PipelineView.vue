<script setup lang="ts">
/**
 * Пайплайн: мок-канбан воронки кандидатов.
 * Визуальный слот — данных нет. Горизонтальная лента стадий с карточками.
 */
import { ref } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useOnline } from '../composables/usePanelWidth'
import { useCountUp } from '../composables/narrative'
import { computed } from 'vue'

interface Candidate {
  name: string
  role: string
  match: number
}
interface Stage {
  id: string
  label: string
  count: number
  candidates: Candidate[]
}

const STAGES: Stage[] = [
  {
    id: 'new', label: 'Новые', count: 4,
    candidates: [
      { name: 'Анна Соколова', role: 'Senior Frontend', match: 88 },
      { name: 'Игорь Васильев', role: 'Backend (Go)', match: 51 },
      { name: 'Лена Морозова', role: 'QA Lead', match: 63 },
    ],
  },
  {
    id: 'screen', label: 'Скрининг', count: 2,
    candidates: [
      { name: 'Дмитрий Орлов', role: 'Tech Lead', match: 72 },
      { name: 'Павел Громов', role: 'DevOps', match: 58 },
    ],
  },
  {
    id: 'interview', label: 'Интервью', count: 1,
    candidates: [
      { name: 'Мария Кузнецова', role: 'Product Designer', match: 64 },
    ],
  },
  {
    id: 'offer', label: 'Оффер', count: 1,
    candidates: [
      { name: 'Олег Тихонов', role: 'Staff Eng', match: 91 },
    ],
  },
]

const loading = ref(true)
const { online } = useOnline()

setTimeout(() => { loading.value = false }, 400)

const totalCount = computed(() => STAGES.reduce((s, st) => s + st.count, 0))
const totalCountUp = useCountUp(totalCount, { id: 'pv-total', decimals: 0 })

function tone(p: number) {
  if (p >= 70) return 'high'
  if (p >= 40) return 'mid'
  return 'low'
}
</script>

<template>
  <div class="pipeline-view hf-scroll">
    <div class="pv-header">
      <h2 class="pv-title">Воронка</h2>
      <HfChip tone="primary">
        <span class="hf-numeric--animate" :style="{ minWidth: totalCountUp.minWidthCh.value }">
          <span aria-hidden="true">{{ totalCountUp.display.value }}</span>
          <span class="hf-sr">{{ totalCountUp.finalDisplay.value }}</span>
        </span>
        кандидатов
      </HfChip>
    </div>

    <!-- Offline -->
    <div v-if="!online" class="pv-banner hf-banner-in">
      <HfIcon name="refresh" :size="16" /> Нет соединения — показана последняя воронка
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="pv-board hf-scroll-none">
      <div v-for="i in 4" :key="i" class="pv-stage">
        <div class="pv-stage-head">
          <HfSkeleton :lines="1" width="50%" />
        </div>
        <div class="pv-stage-body">
          <div v-for="j in 2" :key="j" class="pv-skel"><HfSkeleton :lines="2" /></div>
        </div>
      </div>
    </div>

    <!-- Loaded -->
    <div v-else-if="STAGES.length" class="pv-board hf-scroll">
      <div v-for="st in STAGES" :key="st.id" class="pv-stage">
        <div class="pv-stage-head">
          <span class="pv-stage-label">{{ st.label }}</span>
          <span class="pv-stage-count">{{ st.count }}</span>
        </div>
        <div class="pv-stage-body">
          <article
            v-for="(c, i) in st.candidates"
            :key="c.name"
            class="pv-card hf-cascade"
            :class="`pv-card--${tone(c.match)}`"
            :style="{ '--hf-i': i }"
          >
            <span class="pv-strip" />
            <div class="pv-card-name">{{ c.name }}</div>
            <div class="pv-card-role">{{ c.role }}</div>
            <HfChip :tone="tone(c.match) as any">{{ c.match }}%</HfChip>
          </article>
          <div v-if="!st.candidates.length" class="pv-empty-stage">Пусто</div>
        </div>
      </div>
    </div>

    <HfEmpty v-else icon="pipeline" title="Воронка пуста"
      subtitle="Кандидаты будут появляться на этапах воронки по мере работы." />
  </div>
</template>

<script lang="ts">
export default { name: 'PipelineView' }
</script>

<style scoped>
.pipeline-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }
.pv-header { display: flex; align-items: center; gap: var(--hf-s-3); margin-bottom: var(--hf-s-4); }
.pv-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }

.pv-banner {
  display: flex; align-items: center; gap: var(--hf-s-2);
  padding: var(--hf-s-2) var(--hf-s-3); margin-bottom: var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-info-muted);
  color: var(--hf-info);
  font-size: var(--hf-t-sm);
}

.pv-board { display: flex; gap: var(--hf-s-3); overflow-x: auto; padding-bottom: var(--hf-s-2); }
.pv-stage {
  display: flex; flex-direction: column;
  min-width: 168px; flex: 1;
  background: var(--hf-surface-sunken);
  border-radius: var(--hf-r-lg);
  padding: var(--hf-s-2);
}
.pv-stage-head { display: flex; align-items: center; justify-content: space-between; padding: var(--hf-s-1) var(--hf-s-2) var(--hf-s-2); }
.pv-stage-label { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); }
.pv-stage-count { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.pv-stage-body { display: flex; flex-direction: column; gap: var(--hf-s-2); }

.pv-skel { padding: var(--hf-s-3); background: var(--hf-surface-raised); border-radius: var(--hf-r-md); }

.pv-card {
  position: relative;
  padding: var(--hf-s-3);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  display: flex; flex-direction: column; gap: 2px;
  transition: transform var(--hf-dur-fast) var(--hf-ease-out), box-shadow var(--hf-dur-fast) var(--hf-ease-out);
}
.pv-card:hover { transform: translateY(-1px); box-shadow: var(--hf-shadow-sm); }
.pv-strip { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: var(--hf-r-md) 0 0 var(--hf-r-md); }
.pv-card--high .pv-strip { background: var(--hf-match-high); }
.pv-card--mid .pv-strip { background: var(--hf-match-mid); }
.pv-card--low .pv-strip { background: var(--hf-match-low); }
.pv-card-name { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); padding-left: var(--hf-s-2); }
.pv-card-role { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); padding-left: var(--hf-s-2); margin-bottom: var(--hf-s-2); }
.pv-card :deep(.hf-chip) { margin-left: var(--hf-s-2); align-self: flex-start; }

.pv-empty-stage { padding: var(--hf-s-4); text-align: center; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
</style>
