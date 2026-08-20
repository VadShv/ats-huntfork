<script setup lang="ts">
/**
 * Пайплайн (П2): реальный read-only канбан воронки вакансии.
 * Данные — /api/extension/pipeline (канонические этапы и названия с сервера,
 * дочерние этапы схлопнуты в родителя, как в дашборде ATS).
 */
import { ref, computed, watch, onMounted } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import HfButton from '../ui/HfButton.vue'
import { useOnline } from '../composables/usePanelWidth'
import { useCountUp } from '../fx/narrative'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'

interface PipelineCandidate {
  applicationId: string
  candidateId: string
  name: string
  stageChangedAt: string | null
}
interface PipelineStage {
  id: string
  name: string
  color: string | null
  type: string
  bucket: string
  displayOrder: number
  count: number
  candidates: PipelineCandidate[]
}

const { HUNTFORK_BASE, jobs, selectedJobId, phase } = useSidekick()
const { send, loadJobsOnce, openHuntfork, setJob, fmtDate } = useSidekickActions()

const loading = ref(false)
const errorMsg = ref('')
const stages = ref<PipelineStage[]>([])
const source = ref<'snapshot' | 'live' | 'none'>('none')
const jobTitle = ref('')
const loadedForJob = ref('')
const { online } = useOnline()

const totalCount = computed(() => stages.value.reduce((s, st) => s + st.count, 0))
const totalCountUp = useCountUp(totalCount, { id: 'pv-total', decimals: 0 })

const noSession = computed(() => phase.value === 'no-session')

async function loadPipeline(force = false) {
  const jobId = selectedJobId.value
  if (!jobId) { stages.value = []; loadedForJob.value = ''; return }
  if (!force && loadedForJob.value === jobId) return
  loading.value = true
  errorMsg.value = ''
  const resp = await send({ type: 'pipeline', jobId })
  loading.value = false
  if (!resp?.ok) {
    errorMsg.value = resp?.message || 'Не удалось загрузить воронку'
    return
  }
  stages.value = resp.data?.stages ?? []
  source.value = resp.data?.source ?? 'none'
  jobTitle.value = resp.data?.job?.title ?? ''
  loadedForJob.value = jobId
}

watch(selectedJobId, () => { loadPipeline() })

onMounted(async () => {
  await loadJobsOnce()
  await loadPipeline()
})
</script>

<template>
  <div class="pipeline-view hf-scroll">
    <div class="pv-header">
      <h2 class="pv-title">Воронка</h2>
      <HfChip v-if="stages.length" tone="primary">
        <span class="hf-numeric--animate" :style="{ minWidth: totalCountUp.minWidthCh.value }">
          <span aria-hidden="true">{{ totalCountUp.display.value }}</span>
          <span class="hf-sr">{{ totalCountUp.finalDisplay.value }}</span>
        </span>
        в работе
      </HfChip>
      <button
        class="pv-refresh" title="Обновить" :disabled="loading || !selectedJobId"
        @click="loadPipeline(true)"
      >
        <HfIcon name="refresh" :size="14" />
      </button>
    </div>

    <!-- Селектор вакансии -->
    <div v-if="!noSession" class="pv-job-row">
      <select
        class="pv-job-select" :value="selectedJobId"
        @change="setJob(($event.target as HTMLSelectElement).value)"
      >
        <option value="">— выберите вакансию —</option>
        <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
      </select>
    </div>

    <!-- Нет сессии -->
    <HfEmpty
      v-if="noSession" icon="pipeline" title="Нужен вход в Huntfork"
      subtitle="Войдите на huntfork.ru, чтобы видеть воронку своих вакансий."
      action-label="Открыть huntfork.ru" @action="openHuntfork()"
    />

    <!-- Вакансия не выбрана -->
    <HfEmpty
      v-else-if="!selectedJobId" icon="pipeline" title="Выберите вакансию"
      subtitle="Воронка показывает реальных кандидатов по этапам выбранной вакансии."
    />

    <!-- Offline -->
    <div v-else-if="!online" class="pv-banner hf-banner-in">
      <HfIcon name="refresh" :size="16" /> Нет соединения — воронка недоступна
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

    <!-- Ошибка -->
    <HfEmpty
      v-else-if="errorMsg" icon="pipeline" title="Не удалось загрузить"
      :subtitle="errorMsg" action-label="Повторить" @action="loadPipeline(true)"
    />

    <!-- Loaded -->
    <div v-else-if="stages.length" class="pv-board hf-scroll">
      <div v-for="st in stages" :key="st.id" class="pv-stage">
        <div class="pv-stage-head">
          <span class="pv-stage-label">
            <span v-if="st.color" class="pv-stage-dot" :style="{ background: st.color }" />
            {{ st.name }}
          </span>
          <span class="pv-stage-count">{{ st.count }}</span>
        </div>
        <div class="pv-stage-body">
          <article
            v-for="(c, i) in st.candidates"
            :key="c.applicationId"
            class="pv-card hf-cascade"
            :style="{ '--hf-i': i }"
            role="button" tabindex="0"
            :title="`Открыть кандидата в ATS`"
            @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${c.candidateId}`)"
            @keydown.enter="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${c.candidateId}`)"
          >
            <span class="pv-strip" :style="{ background: st.color || 'var(--hf-border)' }" />
            <div class="pv-card-name">{{ c.name }}</div>
            <div v-if="c.stageChangedAt" class="pv-card-role">на этапе с {{ fmtDate(c.stageChangedAt) }}</div>
          </article>
          <div v-if="st.count > st.candidates.length" class="pv-more">
            ещё {{ st.count - st.candidates.length }} — в ATS
          </div>
          <div v-if="!st.candidates.length" class="pv-empty-stage">Пусто</div>
        </div>
      </div>
    </div>

    <HfEmpty
      v-else icon="pipeline" title="Воронка пуста"
      subtitle="У этой вакансии пока нет видимых этапов или кандидатов."
    >
      <HfButton variant="ghost" size="sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/jobs/${selectedJobId}`)">
        Открыть вакансию в ATS
      </HfButton>
    </HfEmpty>
  </div>
</template>

<script lang="ts">
export default { name: 'PipelineView' }
</script>

<style scoped>
.pipeline-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }
.pv-header { display: flex; align-items: center; gap: var(--hf-s-3); margin-bottom: var(--hf-s-3); }
.pv-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.pv-refresh {
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--hf-r-md);
  border: 1px solid var(--hf-border); background: var(--hf-surface-raised);
  color: var(--hf-fg-muted); cursor: pointer;
}
.pv-refresh:hover:not(:disabled) { color: var(--hf-fg); }
.pv-refresh:disabled { opacity: 0.5; cursor: default; }

.pv-job-row { margin-bottom: var(--hf-s-3); }
.pv-job-select {
  width: 100%;
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-md);
  border: 1px solid var(--hf-border);
  background: var(--hf-surface-raised);
  color: var(--hf-fg);
  font-size: var(--hf-t-sm);
}

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
.pv-stage-label { display: inline-flex; align-items: center; gap: 6px; font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); }
.pv-stage-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
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
  cursor: pointer;
  transition: transform var(--hf-dur-fast) var(--hf-ease-out), box-shadow var(--hf-dur-fast) var(--hf-ease-out);
}
.pv-card:hover { transform: translateY(-1px); box-shadow: var(--hf-shadow-sm); }
.pv-strip { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: var(--hf-r-md) 0 0 var(--hf-r-md); }
.pv-card-name { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); padding-left: var(--hf-s-2); }
.pv-card-role { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); padding-left: var(--hf-s-2); }

.pv-more { padding: var(--hf-s-1) var(--hf-s-2); font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.pv-empty-stage { padding: var(--hf-s-4); text-align: center; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
</style>
