<script setup lang="ts">
/** SmQueries — блок «Поисковые запросы» (блок 3). 18 запросов.
 *  Карточки с подсветкой синтаксиса, копированием (иконка→галочка+тост),
 *  «Открыть», инлайн-правкой с валидацией, индикатором «Использован».
 *  + прогон через Search Gateway (ТЗ §8.1): морфинг кнопка→прогресс→счётчик. */
import { ref, computed } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useToast } from '../../composables/useToast'
import { useSearchMap } from '../../composables/useSearchMap'
import { useSearchRun } from '../../composables/useSearchRun'
import { useCountUp } from '../../fx/narrative'
import { useSidekick } from '../../composables/useSidekick'

const {
  queries, buildQuery, validateQuery, PLATFORM_LABEL,
  editingQueryId, editedQueries, queryUsed, queryResults,
  startEditing, commitEdit, resetEdit, markUsed, copyQuery, usedQueries,
  setQueryResults,
  searchEngine,
} = useSearchMap()
const { toast } = useToast()
const { runState, runResult, runSingle, runBatch, refreshQuery, batchProgress } = useSearchRun()
const { selectedJobId } = useSidekick()

const copiedId = ref<string | null>(null)

/** Прогресс использования запросов — для пружинной заливки --hf-fill. */
const usedPercent = computed(() => {
  const total = queries.value.length || 1
  return Math.round((usedQueries.value / total) * 100)
})
const fillStyle = computed(() => ({
  '--hf-fill': `${usedPercent.value}%`,
}) as Record<string, string>)

/* ── Прогон запросов через Search Gateway (ТЗ §8.1, §8.2) ────── */
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
function fmtFreshness(ts: number): string {
  const d = new Date(ts)
  return `данные от ${d.getDate()} ${MONTHS[d.getMonth()]}`
}
function providerLabel(p: string | undefined): string {
  const map: Record<string,string> = { yandex:'Я', brightdata:'B', brave:'Br', mock:'М' }
  return map[p || ''] || (p ? p.charAt(0).toUpperCase() : '')
}
function providerTitle(p: string | undefined): string {
  const map: Record<string,string> = { yandex:'Yandex Search API', brightdata:'BrightData', brave:'Brave Search', mock:'Тестовый режим' }
  return map[p || ''] || p || ''
}

async function onRun(qId: string) {
  const q = queries.value.find(x => x.id === qId)
  if (!q) return
  await runSingle(qId, buildQuery(q), searchEngine.value, selectedJobId.value || undefined)
  const res = runResult(qId)
  if (res) { setQueryResults(qId, res.total); markUsed(qId) }
}
async function onRefresh(qId: string) {
  const q = queries.value.find(x => x.id === qId)
  if (!q) return
  await refreshQuery(qId, buildQuery(q), searchEngine.value, selectedJobId.value || undefined)
  const res = runResult(qId)
  if (res) setQueryResults(qId, res.total)
}
const isBatchActive = computed(() => batchProgress.value.isActive)
async function onRunAll() {
  const payload = queries.value.map(q => ({ id: q.id, query: buildQuery(q), engine: searchEngine.value }))
  await runBatch(payload, selectedJobId.value || '')
  for (const q of queries.value) {
    const res = runResult(q.id)
    if (res) { setQueryResults(q.id, res.total); markUsed(q.id) }
  }
}

/** Доезжающие числа для batch-панели. */
const batchFoundCount = useCountUp(() => batchProgress.value.found, { id: 'sm-batch-found', compact: true })
const batchDoneCount = useCountUp(() => batchProgress.value.done, { id: 'sm-batch-done', decimals: 0 })
const batchCachedCount = useCountUp(() => batchProgress.value.cached, { id: 'sm-batch-cached', decimals: 0 })

/** Доезжающие числа по каждому запросу (кэшируем composable). */
const _countUpCache: Record<string, ReturnType<typeof useCountUp>> = {}
function countUpFor(qId: string) {
  if (!_countUpCache[qId]) {
    _countUpCache[qId] = useCountUp(() => runResult(qId)?.total || 0, { id: `sm-q-${qId}`, compact: true })
  }
  return _countUpCache[qId]
}

const TYPE_LABEL: Record<string, string> = {
  core: 'Ядро', donor: 'По донорам', product: 'Продукты', profile: 'Профили',
  resume: 'Резюме', community: 'Сообщества', conference: 'Конференции',
  adjacent: 'Соседние роли', broad: 'Широкий', experimental: 'Экспериментальный',
}

/** Разбор запроса на токены для подсветки. */
interface Tok { t: string; cls: string }
function tokenize(q: string): Tok[] {
  const toks: Tok[] = []
  const re = /(\b(?:site:|filetype:|intitle:|inurl:|location:|followers:|repos:)\S*)|("(?:[^"]*)"|\((?:[^)]*)\))|(-(?:\S+))|(\b(?:AND|OR|NOT)\b)|(\s+)|([^\s()"]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(q)) !== null) {
    if (m[1]) toks.push({ t: m[1], cls: 'sm-q-op' })
    else if (m[2]) toks.push({ t: m[2], cls: 'sm-q-phrase' })
    else if (m[3]) toks.push({ t: m[3], cls: 'sm-q-neg' })
    else if (m[4]) toks.push({ t: m[4], cls: 'sm-q-op' })
    else if (m[5]) toks.push({ t: m[5], cls: 'sm-q-ws' })
    else if (m[6]) toks.push({ t: m[6], cls: 'sm-q-txt' })
  }
  return toks
}

function searchUrl(text: string): string {
  if (searchEngine.value === 'yandex') return `https://yandex.ru/search/?text=${encodeURIComponent(text)}`
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

async function onCopy(id: string, text: string) {
  await copyQuery(text)
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, 1400)
  toast('Запрос скопирован', 'success')
}

function openQuery(text: string) {
  window.open(searchUrl(text), '_blank', 'noopener')
  markUsed(queries.value.find(q => buildQuery(q) === text)?.id || '')
}

function isEdited(id: string) {
  return editedQueries[id] != null
}
function issuesFor(id: string) {
  return validateQuery(buildQuery(queries.value.find(q => q.id === id)!))
}
</script>

<template>
  <div class="sm-queries">
    <!-- Панель массового прогона (ТЗ §8.2) -->
    <Transition name="sm-batch">
      <div v-if="isBatchActive || batchProgress.done > 0" class="sm-batch-bar">
       <button class="sm-batch-run" :disabled="isBatchActive" @click="onRunAll">
          <span v-if="isBatchActive" class="hf-spin"><HfIcon name="spinner" :size="14" /></span>
          <HfIcon v-else name="play" :size="14" />
         <span>{{ isBatchActive ? 'Прогон...' : 'Прогнать все' }}</span>
       </button>
        <div class="sm-batch-stats">
          <span class="sm-batch-stat">
            <span class="hf-sr">Прогон карты</span>
            <span aria-hidden="true" class="hf-numeric--animate" :style="{ minWidth: batchDoneCount.minWidthCh.value }">{{ batchDoneCount.display.value }}</span>
            <span class="sm-batch-stat-sep">из</span>
            <span>{{ batchProgress.total }}</span>
          </span>
          <span class="sm-batch-stat sm-batch-stat--found">
            <span class="sm-batch-stat-label">найдено</span>
            <span aria-hidden="true" class="hf-numeric--animate" :style="{ minWidth: batchFoundCount.minWidthCh.value }">{{ batchFoundCount.display.value }}</span>
          </span>
          <span class="sm-batch-stat sm-batch-stat--cached">
            <span class="sm-batch-stat-label">кеш</span>
            <span aria-hidden="true" class="hf-numeric--animate" :style="{ minWidth: batchCachedCount.minWidthCh.value }">{{ batchCachedCount.display.value }}</span>
          </span>
        </div>
      </div>
    </Transition>

    <!-- Прогресс использования -->
    <div class="sm-q-progress" :style="fillStyle">
      <div class="sm-q-progress-head">
        <span class="sm-q-progress-label">Использовано запросов</span>
        <span class="sm-q-progress-count hf-num">{{ usedQueries }}/{{ queries.length }}</span>
      </div>
      <div class="sm-q-progress-track">
        <div class="sm-q-progress-fill" />
      </div>
    </div>

    <div
      v-for="(q, i) in queries"
      :key="q.id"
      class="sm-query hf-cascade"
      :class="{
        'sm-query--used': queryUsed[q.id],
        'sm-query--edited': isEdited(q.id),
        'sm-query--running': runState(q.id) === 'running',
        'sm-query--done': runState(q.id) === 'done',
        'sm-query--empty': runState(q.id) === 'empty',
        'sm-query--error': runState(q.id) === 'error',
      }"
      :style="{ '--hf-i': Math.min(i, 7) }"
    >
      <div class="sm-query-head">
        <span class="sm-query-seq">{{ q.seq }}</span>
        <span class="sm-query-purpose">{{ q.purpose }}</span>
        <span class="sm-query-type">{{ TYPE_LABEL[q.type] }}</span>
        <span class="sm-query-platform">{{ PLATFORM_LABEL[q.platform] }}</span>
        <span v-if="isEdited(q.id)" class="sm-query-edited-tag">Изменён</span>
        <span v-if="queryUsed[q.id]" class="sm-query-used-tag"><HfIcon name="check" :size="10" /> Использован</span>
        <!-- Индикатор статуса прогона -->
        <span
          v-if="runState(q.id) !== 'idle'"
          class="sm-query-run-dot"
          :class="`sm-query-run-dot--${runState(q.id)}`"
        />
      </div>

      <div v-if="editingQueryId === q.id" class="sm-query-edit">
        <textarea v-model="editedQueries[q.id]" class="hf-textarea sm-query-textarea" rows="3" spellcheck="false" />
        <div v-if="issuesFor(q.id).length" class="sm-query-issues">
          <div v-for="(iss, idx) in issuesFor(q.id)" :key="idx" class="sm-query-issue" :class="`sm-query-issue--${iss.severity}`">
            <HfIcon :name="iss.severity === 'error' ? 'alert' : 'alert'" :size="12" /> {{ iss.message }}
          </div>
        </div>
        <div class="sm-query-edit-actions">
          <button class="sm-query-act" @click="commitEdit(q.id)"><HfIcon name="check" :size="12" /> Сохранить</button>
          <button class="sm-query-act sm-query-act--ghost" @click="resetEdit(q.id)">Отменить</button>
        </div>
      </div>

      <pre v-else class="sm-query-code hf-scroll-none"><code><template v-for="(tok, idx) in tokenize(buildQuery(q))" :key="idx"><span :class="`sm-q-${tok.cls.replace('sm-q-','')}`" v-if="tok.cls !== 'sm-q-ws'">{{ tok.t }}</span><span v-else>{{ tok.t }}</span></template></code></pre>

      <div class="sm-query-actions">
        <!-- Кнопка «Прогнать» с морфингом (ТЗ §8.1) -->
        <div class="sm-query-run-zone">
          <Transition name="sm-morph" mode="out-in">
            <!-- idle: кнопка «Прогнать» -->
            <button
              v-if="runState(q.id) === 'idle'"
              key="idle"
              class="sm-query-act sm-query-act--run"
              :disabled="isBatchActive"
              @click="onRun(q.id)"
            >
              <HfIcon name="play" :size="13" /> Прогнать
            </button>
            <!-- running: полоса прогресса -->
            <div v-else-if="runState(q.id) === 'running'" key="running" class="sm-query-running">
              <div class="sm-query-running-bar">
                <div class="sm-query-running-fill" />
              </div>
              <span class="sm-query-running-text">Поиск...</span>
            </div>
            <!-- done: доезжающее число -->
            <div v-else-if="runState(q.id) === 'done'" key="done" class="sm-query-done">
              <span class="sm-query-count hf-numeric--animate" :style="{ minWidth: countUpFor(q.id).minWidthCh.value }">
                <span aria-hidden="true">{{ countUpFor(q.id).display.value }}</span>
                <span class="hf-sr">{{ countUpFor(q.id).finalDisplay.value }}</span>
              </span>
              <span class="sm-query-count-label">найдено</span>
              <span
                v-if="runResult(q.id)?.provider"
                class="sm-query-provider"
                :title="providerTitle(runResult(q.id)?.provider)"
              >{{ providerLabel(runResult(q.id)?.provider) }}</span>
              <button class="sm-query-act sm-query-act--refresh" :disabled="isBatchActive" @click="onRefresh(q.id)" title="Обновить (сброс кеша)">
                <HfIcon name="refresh" :size="12" />
              </button>
            </div>
            <!-- empty: 0 найдено -->
            <div v-else-if="runState(q.id) === 'empty'" key="empty" class="sm-query-empty">
              <span class="sm-query-count sm-query-count--muted">0</span>
              <span class="sm-query-count-label">найдено</span>
              <button class="sm-query-act sm-query-act--refresh" :disabled="isBatchActive" @click="onRefresh(q.id)" title="Обновить (сброс кеша)">
                <HfIcon name="refresh" :size="12" />
              </button>
            </div>
            <!-- error -->
            <div v-else-if="runState(q.id) === 'error'" key="error" class="sm-query-error">
              <HfIcon name="alert" :size="13" />
              <span>Ошибка</span>
              <button class="sm-query-act sm-query-act--refresh" :disabled="isBatchActive" @click="onRun(q.id)" title="Повторить">
                <HfIcon name="refresh" :size="12" />
              </button>
            </div>
          </Transition>
          <!-- Метка свежести -->
          <span
            v-if="runResult(q.id) && (runState(q.id) === 'done' || runState(q.id) === 'empty')"
            class="sm-query-fresh"
          >{{ fmtFreshness(runResult(q.id)!.fetchedAt) }}</span>
        </div>

        <button class="sm-query-act sm-query-act--copy" @click="onCopy(q.id, buildQuery(q))">
          <HfIcon :name="copiedId === q.id ? 'check' : 'copy'" :size="13" />{{ copiedId === q.id ? 'Скопировано' : 'Копировать' }}
        </button>
        <button class="sm-query-act" @click="openQuery(buildQuery(q))">
          <HfIcon name="external" :size="13" /> Открыть
        </button>
        <button class="sm-query-act sm-query-act--ghost" @click="startEditing(q.id)">
          <HfIcon name="scissors" :size="13" /> Править
        </button>
        <span v-if="queryResults[q.id] && runState(q.id) === 'idle'" class="sm-query-results">{{ queryResults[q.id] }} рез.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sm-queries { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.sm-query { border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface); overflow: hidden; }
.sm-query--used { border-color: var(--hf-match-high); }
.sm-query--edited { border-color: var(--hf-primary); }
.sm-query--running { border-color: var(--hf-primary); }
.sm-query--done { border-color: var(--hf-match-high); }
.sm-query--error { border-color: var(--hf-err); }

.sm-query-head { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-2) var(--hf-s-3); background: var(--hf-surface-raised); border-bottom: 1px solid var(--hf-border); flex-wrap: wrap; }
.sm-query-seq { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; border-radius: var(--hf-r-sm); background: var(--hf-primary-muted); color: var(--hf-primary); font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); }
.sm-query-purpose { flex: 1; font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg); min-width: 0; }
.sm-query-type { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.sm-query-platform { font-size: var(--hf-t-xs); padding: 1px 6px; border-radius: var(--hf-r-sm); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); }
.sm-query-edited-tag { font-size: var(--hf-t-xs); padding: 1px 6px; border-radius: var(--hf-r-pill); background: var(--hf-primary-muted); color: var(--hf-primary); }
.sm-query-used-tag { display: inline-flex; align-items: center; gap: 2px; font-size: var(--hf-t-xs); padding: 1px 6px; border-radius: var(--hf-r-pill); background: var(--hf-match-high-muted); color: var(--hf-match-high); }

/* Индикатор статуса — точка */
.sm-query-run-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-left: auto; }
.sm-query-run-dot--running { background: var(--hf-primary); animation: hf-pulse 1.2s var(--hf-ease-out) infinite; }
.sm-query-run-dot--done { background: var(--hf-match-high); }
.sm-query-run-dot--empty { background: var(--hf-fg-subtle); }
.sm-query-run-dot--error { background: var(--hf-err); }

.sm-query-code { margin: 0; padding: var(--hf-s-3); background: var(--hf-surface-sunken); font-family: var(--hf-mono); font-size: 11.5px; line-height: 1.5; color: var(--hf-fg); white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
.sm-query-code code { font-family: inherit; }
.sm-q-op { color: var(--hf-primary); font-weight: var(--hf-fw-semibold); }
.sm-q-phrase { color: var(--hf-match-high); }
.sm-q-neg { color: var(--hf-match-low); }
.sm-q-txt { color: var(--hf-fg); }

.sm-query-actions { display: flex; align-items: center; gap: var(--hf-s-1); padding: var(--hf-s-2) var(--hf-s-3); border-top: 1px solid var(--hf-border); flex-wrap: wrap; }
.sm-query-act { display: inline-flex; align-items: center; gap: 4px; padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out), transform var(--hf-dur-fast) var(--hf-ease-spring); }
.sm-query-act:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.sm-query-act:active { transform: scale(0.96); }
.sm-query-act:disabled { opacity: 0.5; cursor: not-allowed; }
.sm-query-act--copy:hover { background: var(--hf-primary-muted); color: var(--hf-primary); }
.sm-query-act--ghost { color: var(--hf-fg-subtle); }
.sm-query-act--run { color: var(--hf-primary); }
.sm-query-act--run:hover { background: var(--hf-primary-muted); color: var(--hf-primary); }
.sm-query-act--refresh { padding: var(--hf-s-1); }
.sm-query-results { margin-left: auto; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); font-family: var(--hf-mono); }

/* ── Зона прогона (морфинг) ── */
.sm-query-run-zone { display: flex; align-items: center; gap: var(--hf-s-2); flex-wrap: wrap; }
.sm-query-running { display: flex; align-items: center; gap: 6px; min-width: 120px; }
.sm-query-running-bar { flex: 1; height: 4px; min-width: 60px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); overflow: hidden; position: relative; }
.sm-query-running-fill { position: absolute; inset: 0; width: 40%; border-radius: var(--hf-r-pill); background: var(--hf-primary); animation: sm-run-sweep 1.1s var(--hf-ease-out) infinite; }
.sm-query-running-text { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); white-space: nowrap; }
@keyframes sm-run-sweep { 0% { left: -40%; } 100% { left: 100%; } }

.sm-query-done { display: inline-flex; align-items: baseline; gap: 4px; }
.sm-query-count { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-bold); color: var(--hf-match-high); font-family: var(--hf-mono); font-variant-numeric: tabular-nums; }
.sm-query-count--muted { color: var(--hf-fg-subtle); }
.sm-query-count-label { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.sm-query-provider { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 16px; padding: 0 4px; border-radius: var(--hf-r-sm); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); font-size: 10px; font-weight: var(--hf-fw-semibold); font-family: var(--hf-mono); }
.sm-query-empty { display: inline-flex; align-items: baseline; gap: 4px; }
.sm-query-error { display: inline-flex; align-items: center; gap: 4px; color: var(--hf-err); font-size: var(--hf-t-xs); }
.sm-query-fresh { font-size: 10px; color: var(--hf-fg-subtle); }

/* Морфинг: плавная смена состояний */
.sm-morph-enter-active, .sm-morph-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out), transform var(--hf-dur-fast) var(--hf-ease-spring); }
.sm-morph-enter-from { opacity: 0; transform: scale(0.92); }
.sm-morph-leave-to { opacity: 0; transform: scale(0.92); }
@media (prefers-reduced-motion: reduce) { .sm-morph-enter-active, .sm-morph-leave-active { transition: none; } }

.sm-query-edit { padding: var(--hf-s-2) var(--hf-s-3); }
.sm-query-textarea { font-family: var(--hf-mono); font-size: 11.5px; }
.sm-query-issues { margin-top: var(--hf-s-2); display: flex; flex-direction: column; gap: 2px; }
.sm-query-issue { display: flex; align-items: center; gap: 4px; font-size: var(--hf-t-xs); }
.sm-query-issue--error { color: var(--hf-err); }
.sm-query-issue--warn { color: var(--hf-warn); }
.sm-query-edit-actions { display: flex; gap: var(--hf-s-2); margin-top: var(--hf-s-2); }
@media (prefers-reduced-motion: reduce) { .sm-query { animation: none !important; } }

.sm-q-progress { margin-bottom: var(--hf-s-2); }
.sm-q-progress-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--hf-s-1); }
.sm-q-progress-label { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.sm-q-progress-count { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); font-variant-numeric: tabular-nums; }
.sm-q-progress-track { position: relative; height: 4px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); overflow: hidden; }
.sm-q-progress-fill { position: absolute; left: 0; top: 0; bottom: 0; width: var(--hf-fill, 0%); border-radius: var(--hf-r-pill); background: var(--hf-fg); transition: width var(--spring-gentle-dur) var(--spring-gentle); }
@media (prefers-reduced-motion: reduce) { .sm-q-progress-fill { transition: none; } }

/* ── Панель массового прогона (§8.2) ── */
.sm-batch-bar { display: flex; align-items: center; gap: var(--hf-s-3); padding: var(--hf-s-2) var(--hf-s-3); border-radius: var(--hf-r-md); background: var(--hf-surface-raised); border: 1px solid var(--hf-border); margin-bottom: var(--hf-s-2); flex-wrap: wrap; }
.sm-batch-run { display: inline-flex; align-items: center; gap: 6px; padding: var(--hf-s-1) var(--hf-s-3); border-radius: var(--hf-r-sm); background: var(--hf-primary); color: var(--hf-surface); font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); transition: background var(--hf-dur-fast), opacity var(--hf-dur-fast); flex-shrink: 0; }
.sm-batch-run:hover:not(:disabled) { background: var(--hf-primary-strong); }
.sm-batch-run:disabled { opacity: 0.6; cursor: not-allowed; }
.sm-batch-stats { display: flex; align-items: center; gap: var(--hf-s-3); flex-wrap: wrap; }
.sm-batch-stat { display: inline-flex; align-items: baseline; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); font-variant-numeric: tabular-nums; }
.sm-batch-stat-sep { color: var(--hf-fg-subtle); }
.sm-batch-stat--found { color: var(--hf-match-high); font-weight: var(--hf-fw-semibold); }
.sm-batch-stat--cached { color: var(--hf-fg-subtle); }
.sm-batch-stat-label { color: var(--hf-fg-subtle); }
.sm-batch-enter-active, .sm-batch-leave-active { transition: opacity var(--hf-dur-base) var(--hf-ease-out), transform var(--hf-dur-base) var(--hf-ease-out); }
.sm-batch-enter-from, .sm-batch-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
