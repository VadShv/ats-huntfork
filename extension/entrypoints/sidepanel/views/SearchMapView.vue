<script setup lang="ts">
/**
 * Карта поиска (П6): реальная генерация через серверный ИИ по вакансии из ATS.
 * Честные состояния, без моков. Старый демо-прототип — за флагом «Экспериментальное».
 */
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfButton from '../ui/HfButton.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import PrototypeBadge from '../ui/PrototypeBadge.vue'
import { useSearchMapRun, SM_PLATFORM_LABELS } from '../composables/useSearchMapRun'
import { useDevPrototypes } from '../composables/useDevPrototypes'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'

// Демо-прототип — только за флагом, лениво (моки вне основного бандла).
const SearchMapDemoView = defineAsyncComponent(() => import('./SearchMapDemoView.vue'))

const { state, map, meta, errorMsg, run, reset, copyQuery, copyAll } = useSearchMapRun()
const { devPrototypes } = useDevPrototypes()
const { jobs, selectedJobId, phase } = useSidekick()
const { loadJobsOnce, setJob } = useSidekickActions()

const showDemo = ref(false)
const noSession = computed(() => phase.value === 'no-session')

onMounted(() => { loadJobsOnce() })

function platformLabel(p: string): string {
  return SM_PLATFORM_LABELS[p] ?? p
}
</script>

<template>
  <div class="smr hf-scroll">
    <template v-if="devPrototypes && showDemo">
      <div class="smr-demo-bar">
        <HfButton variant="ghost" size="sm" @click="showDemo = false">
          <HfIcon name="chevron-down" :size="14" /> К реальной карте
        </HfButton>
      </div>
      <SearchMapDemoView />
    </template>

    <template v-else>
      <div class="smr-header">
        <h3 class="smr-title">Карта поиска</h3>
        <HfButton
          v-if="devPrototypes" variant="ghost" size="sm"
          title="Демо-прототип — данные не настоящие" @click="showDemo = true"
        >
          <PrototypeBadge label="Демо" />
        </HfButton>
      </div>

      <HfEmpty
        v-if="noSession" icon="map" title="Нужен вход в Huntfork"
        subtitle="Карта строится ИИ-контуром организации по вакансии из ATS."
      />

      <template v-else>
        <!-- Селектор вакансии -->
        <div class="smr-job-row">
          <select
            class="smr-job-select" :value="selectedJobId ?? ''"
            @change="setJob(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Выберите вакансию…</option>
            <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}</option>
          </select>
          <HfButton
            variant="primary" size="sm"
            :disabled="!selectedJobId || state === 'running'" @click="run"
          >
            <HfIcon name="map" :size="14" />
            {{ state === 'running' ? 'Строю…' : map ? 'Перестроить' : 'Построить карту' }}
          </HfButton>
        </div>

        <p v-if="state === 'error' && errorMsg" class="smr-error">{{ errorMsg }}</p>

        <!-- Idle -->
        <HfEmpty
          v-if="state === 'idle' && !map" icon="map" title="Карта ещё не построена"
          subtitle="ИИ проанализирует описание вакансии и предложит компании-доноры, гипотезы, готовые запросы по площадкам и анти-ключи."
        />

        <!-- Running -->
        <div v-else-if="state === 'running'" class="smr-running">
          <div v-for="i in 4" :key="i" class="smr-skel"><HfSkeleton :lines="2" /></div>
        </div>

        <!-- Done -->
        <div v-else-if="map" class="smr-map">
          <section class="smr-block">
            <h4 class="smr-block-title"><HfIcon name="target" :size="14" /> Профиль кандидата</h4>
            <p class="smr-text">{{ map.profileSummary }}</p>
          </section>

          <section v-if="map.donors.length" class="smr-block">
            <h4 class="smr-block-title"><HfIcon name="building" :size="14" /> Компании-доноры</h4>
            <ul class="smr-list">
              <li v-for="(d, i) in map.donors" :key="i" class="smr-item">
                <strong>{{ d.company }}</strong> — {{ d.why }}
              </li>
            </ul>
          </section>

          <section v-if="map.hypotheses.length" class="smr-block">
            <h4 class="smr-block-title"><HfIcon name="brain" :size="14" /> Гипотезы поиска</h4>
            <ul class="smr-list">
              <li v-for="(h, i) in map.hypotheses" :key="i" class="smr-hypo">
                <div class="smr-hypo-head">
                  <strong>{{ h.title }}</strong>
                  <span class="smr-channels">
                    <HfChip v-for="c in h.channels" :key="c" tone="default">{{ platformLabel(c) }}</HfChip>
                  </span>
                </div>
                <p class="smr-text">{{ h.description }}</p>
              </li>
            </ul>
          </section>

          <section v-if="map.queries.length" class="smr-block">
            <h4 class="smr-block-title"><HfIcon name="search" :size="14" /> Поисковые запросы</h4>
            <div v-for="(q, i) in map.queries" :key="i" class="smr-query">
              <div class="smr-query-head">
                <HfChip tone="primary">{{ platformLabel(q.platform) }}</HfChip>
                <span v-if="q.note" class="smr-query-note">{{ q.note }}</span>
                <button class="smr-copy" title="Копировать запрос" @click="copyQuery(q)">
                  <HfIcon name="copy" :size="13" />
                </button>
              </div>
              <code class="smr-query-code">{{ q.query }}</code>
            </div>
          </section>

          <section v-if="map.antiKeywords.length" class="smr-block">
            <h4 class="smr-block-title"><HfIcon name="ban" :size="14" /> Анти-ключи</h4>
            <div class="smr-anti">
              <HfChip v-for="k in map.antiKeywords" :key="k" tone="mid">{{ k }}</HfChip>
            </div>
          </section>

          <div class="smr-actions">
            <HfButton variant="ghost" size="sm" @click="copyAll">
              <HfIcon name="copy" :size="14" /> Копировать карту
            </HfButton>
            <HfButton variant="ghost" size="sm" @click="reset">
              <HfIcon name="refresh" :size="14" /> Сбросить
            </HfButton>
          </div>

          <p v-if="meta" class="smr-meta">
            {{ meta.provider || 'ИИ' }}{{ meta.model ? ` · ${meta.model}` : '' }}
            · карта не сохраняется на сервере
          </p>
        </div>
      </template>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'SearchMapView' }
</script>

<style scoped>
.smr { padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }
.smr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--hf-s-3); }
.smr-title { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.smr-demo-bar { padding: var(--hf-s-2) var(--hf-s-4) 0; }

.smr-job-row { display: flex; gap: var(--hf-s-2); align-items: center; margin-bottom: var(--hf-s-3); }
.smr-job-select {
  flex: 1; min-width: 0;
  padding: 7px 10px;
  border-radius: var(--hf-r-md);
  border: 1px solid var(--hf-border);
  background: var(--hf-surface-raised);
  color: var(--hf-fg);
  font-size: var(--hf-t-sm);
}
.smr-error {
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-err-muted);
  color: var(--hf-err);
  font-size: var(--hf-t-sm);
  margin-bottom: var(--hf-s-3);
}

.smr-running { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.smr-skel { padding: var(--hf-s-3); background: var(--hf-surface-raised); border-radius: var(--hf-r-md); }

.smr-map { display: flex; flex-direction: column; gap: var(--hf-s-4); }
.smr-block { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.smr-block-title {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted);
}
.smr-text { font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: 1.55; }
.smr-list { display: flex; flex-direction: column; gap: var(--hf-s-2); list-style: none; padding: 0; margin: 0; font-size: var(--hf-t-sm); line-height: 1.5; color: var(--hf-fg); }
.smr-hypo { display: flex; flex-direction: column; gap: 4px; }
.smr-hypo-head { display: flex; flex-wrap: wrap; gap: var(--hf-s-2); align-items: center; }
.smr-channels { display: inline-flex; flex-wrap: wrap; gap: 4px; }

.smr-query {
  display: flex; flex-direction: column; gap: 6px;
  padding: var(--hf-s-3);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
}
.smr-query + .smr-query { margin-top: var(--hf-s-2); }
.smr-query-head { display: flex; align-items: center; gap: var(--hf-s-2); }
.smr-query-note { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); flex: 1; min-width: 0; }
.smr-copy {
  margin-left: auto; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border-radius: var(--hf-r-sm);
  border: none; background: transparent; color: var(--hf-fg-muted);
  cursor: pointer;
}
.smr-copy:hover { background: var(--hf-hover); color: var(--hf-fg); }
.smr-query-code {
  font-family: var(--hf-mono);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.smr-anti { display: flex; flex-wrap: wrap; gap: 6px; }
.smr-actions { display: flex; gap: var(--hf-s-2); }
.smr-meta { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); text-align: center; }
</style>
