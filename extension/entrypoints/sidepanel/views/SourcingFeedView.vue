<script setup lang="ts">
/**
 * SourcingFeedView — лента кандидатов сорсинга по выбранной вакансии.
 *
 * Читает данные из АТС через useSourcingFeed. Поддерживает:
 *  - выбор вакансии (синхронизирован с глобальным selectedJobId)
 *  - фильтр по статусу (active/new/approved/rejected/imported)
 *  - infinite scroll через IntersectionObserver
 *  - действия: одобрить / отклонить / заметка / импорт в воронку
 */
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import HfButton from '../ui/HfButton.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfIcon from '../ui/HfIcon.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'
import { useSourcingFeed, type SourcingState } from '../composables/useSourcingFeed'
import SourcingFeedCard from './SourcingFeedCard.vue'

const {
  jobs, selectedJobId,
} = useSidekick()
const {
  loadJobsOnce, setJob,
} = useSidekickActions()

const {
  items, stateFilter, loading, loadingMore, error, hasMore, currentJobId,
  actionStates,
  loadFeed, loadMore, setStateFilter,
  applyAction, importToPipeline, enrichCandidate,
} = useSourcingFeed()

const jobMenuOpen = ref(false)
const scrollRoot = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const selectedJob = computed(() => jobs.value.find(j => j.id === selectedJobId.value))

const filters: Array<{ id: SourcingState, label: string }> = [
  { id: 'active', label: 'В работе' },
  { id: 'new', label: 'Новые' },
  { id: 'approved', label: 'Одобренные' },
  { id: 'rejected', label: 'Отклонённые' },
  { id: 'imported', label: 'В воронке' },
]

function toggleJobMenu() { jobMenuOpen.value = !jobMenuOpen.value }

function pickJob(id: string) {
  setJob(id)
  jobMenuOpen.value = false
  if (id) loadFeed(id, true)
}

function onApprove(id: string) { applyAction(id, 'approve') }
function onReject(id: string) { applyAction(id, 'reject') }
function onImport(id: string) {
  if (confirm('Импортировать кандидата в воронку? Это потратит квоту hh.ru на получение резюме.')) {
    importToPipeline(id)
  }
}
function onSaveNote(id: string, note: string) { applyAction(id, 'markReviewed', note) }

function setupObserver() {
  if (observer) observer.disconnect()
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
      loadMore()
    }
  }, { root: scrollRoot.value, rootMargin: '200px' })
  if (sentinel.value) observer.observe(sentinel.value)
}

// При смене вакансии извне (из чата) — подгружаем ленту
watch(selectedJobId, (id) => {
  if (id && id !== currentJobId.value) {
    loadFeed(id, true)
  }
  else if (!id) {
    currentJobId.value = ''
    items.value = []
  }
})

// После обновления списка — переподключаем observer (sentinel мог пересоздаться)
watch([items, hasMore], async () => {
  await nextTick()
  setupObserver()
})

onMounted(async () => {
  await loadJobsOnce()
  if (selectedJobId.value) {
    await loadFeed(selectedJobId.value, true)
  }
  await nextTick()
  setupObserver()
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="sf-view">
    <!-- Шапка: вакансия -->
    <div class="sf-bar">
      <div class="sf-job">
        <button class="sf-job-trigger" :class="{ 'sf-job-trigger--set': !!selectedJob }" @click="toggleJobMenu">
          <HfIcon name="briefcase" :size="14" />
          <span class="sf-job-label">{{ selectedJob ? selectedJob.title : 'Вакансия не выбрана' }}</span>
          <HfIcon name="chevron-down" :size="12" />
        </button>
        <Transition name="hf-pop">
          <div v-if="jobMenuOpen" class="sf-job-menu hf-popover-in hf-scroll">
            <div class="sf-job-menu-head">Выбрать вакансию</div>
            <button v-if="!jobs.length" class="sf-job-menu-empty" disabled>Нет активных вакансий</button>
            <button
              v-for="j in jobs"
              :key="j.id"
              class="sf-job-menu-row"
              :class="{ 'sf-job-menu-row--active': j.id === selectedJobId }"
              @click="pickJob(j.id)"
            >
              <span class="sf-job-menu-title">{{ j.title }}</span>
              <span class="sf-job-menu-status">{{ j.status }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Фильтры -->
    <div v-if="selectedJob" class="sf-filters">
      <button
        v-for="f in filters"
        :key="f.id"
        class="sf-filter"
        :class="{ 'sf-filter--active': stateFilter === f.id }"
        @click="setStateFilter(f.id)"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Контент -->
    <div ref="scrollRoot" class="sf-scroll">
      <!-- Нет вакансии -->
      <HfEmpty v-if="!selectedJob" icon="sourcing" title="Выберите вакансию"
        subtitle="Лента кандидатов сорсинга привязана к конкретной вакансии. Выберите её выше или в разделе чата." />

      <!-- Загрузка -->
      <div v-else-if="loading" class="sf-list">
        <HfSkeleton v-for="i in 3" :key="i" :lines="6" />
      </div>

      <!-- Ошибка -->
      <div v-else-if="error" class="sf-error">
        <HfIcon name="alert" :size="20" />
        <p>{{ error }}</p>
        <HfButton variant="ghost" size="sm" @click="loadFeed(selectedJobId, true)">Повторить</HfButton>
      </div>

      <!-- Пусто -->
      <HfEmpty v-else-if="!items.length" icon="sourcing" title="Кандидатов нет"
        subtitle="По этой вакансии ещё не найдено кандидатов сорсинга. Запустите поиск в дашборде Huntfork." />

      <!-- Лента -->
      <div v-else class="sf-list">
        <SourcingFeedCard
          v-for="c in items"
          :key="c.id"
          :candidate="c"
          :action-state="actionStates[c.id]"
          @approve="onApprove"
          @reject="onReject"
          @import="onImport"
          @enrich="enrichCandidate"
          @save-note="onSaveNote"
        />

        <!-- Подгрузка -->
        <div v-if="loadingMore" class="sf-more">
          <HfSkeleton :lines="6" />
        </div>
        <div ref="sentinel" class="sf-sentinel" />
        <div v-if="!hasMore && items.length > 0" class="sf-end">
          <span>Конец списка · {{ items.length }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'SourcingFeedView' }
</script>

<style scoped>
.sf-view { height: 100%; display: flex; flex-direction: column; }

.sf-bar { padding: var(--hf-s-3) var(--hf-s-4) 0; }
.sf-job { position: relative; }
.sf-job-trigger { display: flex; align-items: center; gap: var(--hf-s-2); width: 100%; padding: var(--hf-s-2) var(--hf-s-3); background: var(--hf-surface-sunken); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); font-size: var(--hf-t-sm); color: var(--hf-fg-muted); cursor: pointer; transition: border-color var(--hf-dur-fast) var(--hf-ease-out); }
.sf-job-trigger:hover { border-color: var(--hf-border-strong); }
.sf-job-trigger--set { color: var(--hf-fg); }
.sf-job-label { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sf-job-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10; max-height: 280px; overflow-y: auto; background: var(--hf-surface); border: 1px solid var(--hf-border-strong); border-radius: var(--hf-r-md); box-shadow: var(--hf-shadow-sm); padding: var(--hf-s-1); }
.sf-job-menu-head { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); padding: var(--hf-s-2) var(--hf-s-3); }
.sf-job-menu-empty { width: 100%; text-align: left; padding: var(--hf-s-2) var(--hf-s-3); font-size: var(--hf-t-sm); color: var(--hf-fg-subtle); background: none; border: none; cursor: default; }
.sf-job-menu-row { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-2); width: 100%; text-align: left; padding: var(--hf-s-2) var(--hf-s-3); border: none; border-radius: var(--hf-r-sm); background: none; cursor: pointer; font-size: var(--hf-t-sm); }
.sf-job-menu-row:hover { background: var(--hf-surface-sunken); }
.sf-job-menu-row--active { background: var(--hf-surface-sunken); color: var(--hf-primary); font-weight: var(--hf-fw-semibold); }
.sf-job-menu-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-job-menu-status { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); flex-shrink: 0; text-transform: capitalize; }

.sf-filters { display: flex; gap: var(--hf-s-1); padding: var(--hf-s-3) var(--hf-s-4); overflow-x: auto; }
.sf-filter { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-medium); padding: var(--hf-s-1) var(--hf-s-3); border-radius: var(--hf-r-pill); border: 1px solid var(--hf-border); background: var(--hf-surface); color: var(--hf-fg-muted); cursor: pointer; white-space: nowrap; transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.sf-filter:hover { color: var(--hf-fg); border-color: var(--hf-border-strong); }
.sf-filter--active { background: var(--hf-primary); color: var(--hf-fg-on-accent); border-color: var(--hf-primary); }

.sf-scroll { flex: 1; overflow-y: auto; padding: 0 var(--hf-s-4) var(--hf-s-4); }
.sf-list { display: flex; flex-direction: column; gap: var(--hf-s-3); }

.sf-error { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-8); text-align: center; color: var(--hf-err); }

.sf-more { padding-top: var(--hf-s-2); }
.sf-sentinel { height: 1px; }
.sf-end { text-align: center; padding: var(--hf-s-4); font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
</style>
