<script setup lang="ts">
/**
 * Верификация (П4): реальная проверка резюме через серверный ИИ.
 * Честные состояния: idle → running → done/error. Без моков.
 * Демо-прототип «Волкодав» доступен за флагом «Экспериментальное».
 */
import { ref, computed, watch, nextTick, defineAsyncComponent } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfButton from '../ui/HfButton.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import HfStages from '../ui/HfStages.vue'
import PrototypeBadge from '../ui/PrototypeBadge.vue'

import { useVerificationRun } from '../composables/useVerificationRun'
import { useDevPrototypes } from '../composables/useDevPrototypes'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'

// Демо «Волкодав» — только за флагом, грузим лениво (моки вне основного бандла).
const VerificationDemoView = defineAsyncComponent(() => import('./VerificationDemoView.vue'))

const {
  state, report, meta, errorMsg, savingNote, noteSaved,
  hasText, canSaveToAts, run, stop, reset, saveToAts, copyReport,
} = useVerificationRun()
const { devPrototypes } = useDevPrototypes()
const { capturing, phase } = useSidekick()
const { grabPage } = useSidekickActions()

const showDemo = ref(false)

const noSession = computed(() => phase.value === 'no-session')

function sevTone(s: string): 'high' | 'mid' | 'low' {
  if (s === 'high') return 'high'
  if (s === 'medium') return 'mid'
  return 'low'
}

const VERIFIABILITY_LABELS: Record<string, string> = {
  verifiable: 'проверяемо',
  partially: 'частично',
  unverifiable: 'непроверяемо',
}

async function readPageAndRun() {
  await grabPage()
  if (hasText.value) await run()
}

// П6: этап генерации для индикатора «Читаю → Думаю → Пишу»
const runStage = computed<'read' | 'think' | 'write'>(() => {
  if (capturing.value) return 'read'
  return report.value?.summary ? 'write' : 'think'
})

// П6: автоскролл — липнем к низу, пока пользователь не прокрутил вверх
const SCROLL_STICK = 60
const scrollEl = ref<HTMLElement | null>(null)
let stickToBottom = true
function onScroll() {
  const el = scrollEl.value
  if (!el) return
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_STICK
}
watch(state, (s) => { if (s === 'running') stickToBottom = true })
watch(report, async () => {
  if (state.value !== 'running' || !stickToBottom) return
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}, { deep: true })
</script>

<template>
  <div ref="scrollEl" class="vfr hf-scroll" @scroll="onScroll">
    <!-- Демо-прототип за флагом -->
    <template v-if="devPrototypes && showDemo">
      <div class="vfr-demo-bar">
        <HfButton variant="ghost" size="sm" @click="showDemo = false">
          <HfIcon name="chevron-down" :size="14" /> К реальной проверке
        </HfButton>
      </div>
      <VerificationDemoView />
    </template>

    <template v-else>
      <div class="vfr-header">
        <h3 class="vfr-title">Верификация резюме</h3>
        <HfButton
          v-if="devPrototypes" variant="ghost" size="sm"
          title="Демо-прототип «Волкодав» — данные не настоящие"
          @click="showDemo = true"
        >
          <PrototypeBadge label="Демо" />
        </HfButton>
      </div>

      <!-- Нет сессии -->
      <HfEmpty
        v-if="noSession" icon="fingerprint" title="Нужен вход в Huntfork"
        subtitle="Проверка выполняется ИИ-контуром вашей организации на сервере."
      />

      <!-- Idle -->
      <div v-else-if="state === 'idle' || state === 'error'" class="vfr-start">
        <HfEmpty
          icon="fingerprint"
          :title="hasText ? 'Готово к проверке' : 'Считайте страницу с резюме'"
          :subtitle="hasText
            ? 'Текст страницы получен. Проверка: таймлайн, противоречия, проверяемость утверждений, ред-флаги и вопросы к интервью.'
            : 'Откройте резюме или профиль кандидата и считайте страницу — текст уйдёт на анализ ИИ-контуру организации.'"
        />
        <p v-if="state === 'error' && errorMsg" class="vfr-error">{{ errorMsg }}</p>
        <div class="vfr-actions">
          <HfButton v-if="!hasText" variant="primary" :disabled="capturing" @click="readPageAndRun">
            <HfIcon name="sourcing" :size="14" />
            {{ capturing ? 'Читаю страницу…' : 'Считать страницу и проверить' }}
          </HfButton>
          <HfButton v-else variant="primary" @click="run">
            <HfIcon name="fingerprint" :size="14" /> Проверить
          </HfButton>
        </div>
        <p class="vfr-ethics">
          Отчёт носит рекомендательный характер: это вопросы к интервью,
          а не вывод о добросовестности кандидата.
        </p>
      </div>

      <!-- Running: этапы + стоп, пока нет первых секций -->
      <div v-else-if="state === 'running' && !report?.summary" class="vfr-running">
        <HfStages :stage="runStage" />
        <div v-for="i in 4" :key="i" class="vfr-skel"><HfSkeleton :lines="2" /></div>
        <div class="vfr-actions">
          <HfButton variant="ghost" size="sm" @click="stop">
            <HfIcon name="stop" :size="14" /> Стоп
          </HfButton>
        </div>
      </div>

      <!-- Отчёт: стримится или готов -->
      <div v-else-if="report && (state === 'running' || state === 'done')" class="vfr-report">
        <template v-if="state === 'running'">
          <HfStages :stage="runStage" />
        </template>

        <section class="vfr-block">
          <h4 class="vfr-block-title"><HfIcon name="sparkle" :size="14" /> Сводка</h4>
          <p class="vfr-summary">{{ report.summary }}<span v-if="state === 'running' && !report.timeline.length" class="hf-caret" /></p>
        </section>

        <section v-if="report.timeline.length" class="vfr-block">
          <h4 class="vfr-block-title"><HfIcon name="timeline" :size="14" /> Таймлайн</h4>
          <ul class="vfr-list">
            <li v-for="(t, i) in report.timeline" :key="i" class="vfr-tl-row">
              <span class="vfr-tl-period">{{ t.period }}</span>
              <span class="vfr-tl-body">
                <strong>{{ t.place }}</strong> — {{ t.role }}
                <em v-if="t.note" class="vfr-note">{{ t.note }}</em>
                <HfChip v-if="t.gap" tone="mid">пробел: {{ t.gap }}</HfChip>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="report.contradictions.length" class="vfr-block">
          <h4 class="vfr-block-title"><HfIcon name="ban" :size="14" /> Противоречия</h4>
          <ul class="vfr-list">
            <li v-for="(c, i) in report.contradictions" :key="i" class="vfr-item">
              <HfChip :tone="sevTone(c.severity)">{{ c.severity }}</HfChip>
              <span><strong>{{ c.claim }}</strong> — {{ c.issue }}</span>
            </li>
          </ul>
        </section>

        <section v-if="report.redFlags.length" class="vfr-block">
          <h4 class="vfr-block-title"><HfIcon name="alert" :size="14" /> Ред-флаги</h4>
          <ul class="vfr-list">
            <li v-for="(f, i) in report.redFlags" :key="i" class="vfr-item">
              <HfChip :tone="sevTone(f.severity)">{{ f.severity }}</HfChip>
              <span><strong>{{ f.flag }}</strong> — {{ f.basis }}</span>
            </li>
          </ul>
        </section>

        <section v-if="report.verifiability.length" class="vfr-block">
          <h4 class="vfr-block-title"><HfIcon name="fingerprint" :size="14" /> Проверяемость утверждений</h4>
          <ul class="vfr-list">
            <li v-for="(v, i) in report.verifiability" :key="i" class="vfr-item">
              <HfChip :tone="v.status === 'verifiable' ? 'low' : v.status === 'partially' ? 'mid' : 'high'">
                {{ VERIFIABILITY_LABELS[v.status] ?? v.status }}
              </HfChip>
              <span>{{ v.claim }}<em v-if="v.how" class="vfr-note"> · {{ v.how }}</em></span>
            </li>
          </ul>
        </section>

        <section v-if="report.questions.length" class="vfr-block">
          <h4 class="vfr-block-title"><HfIcon name="help" :size="14" /> Вопросы к интервью</h4>
          <ol class="vfr-questions">
            <li v-for="(q, i) in report.questions" :key="i">{{ q }}</li>
          </ol>
        </section>

        <!-- Хвостовой скелетон и Стоп — пока стрим идёт -->
        <template v-if="state === 'running'">
          <div class="vfr-skel"><HfSkeleton :lines="2" width="70%" /></div>
          <div class="vfr-actions">
            <HfButton variant="ghost" size="sm" @click="stop">
              <HfIcon name="stop" :size="14" /> Стоп
            </HfButton>
          </div>
        </template>

        <div v-if="state === 'done'" class="vfr-actions">
          <HfButton
            v-if="canSaveToAts" variant="primary" size="sm"
            :disabled="savingNote || noteSaved" @click="saveToAts"
          >
            <HfIcon name="note" :size="14" />
            {{ noteSaved ? 'Сохранено в ATS' : savingNote ? 'Сохраняю…' : 'Сохранить в ATS' }}
          </HfButton>
          <HfButton variant="ghost" size="sm" @click="copyReport">
            <HfIcon name="copy" :size="14" /> Копировать
          </HfButton>
          <HfButton variant="ghost" size="sm" @click="reset">
            <HfIcon name="refresh" :size="14" /> Новая проверка
          </HfButton>
        </div>

        <p v-if="state === 'done' && meta" class="vfr-meta">
          {{ meta.provider || 'ИИ' }}{{ meta.model ? ` · ${meta.model}` : '' }}{{ meta.totalMs ? ` · ${(meta.totalMs / 1000).toFixed(1).replace('.', ',')} с` : '' }}
          · отчёт не сохраняется на сервере
        </p>
        <p v-if="state === 'done'" class="vfr-ethics">
          Это не вывод о добросовестности кандидата и не основание для отказа.
        </p>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'VerificationView' }
</script>

<style scoped>
.vfr { padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; width: 100%; min-width: 0; }
.vfr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--hf-s-3); }
.vfr-title { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.vfr-demo-bar { padding: var(--hf-s-2) var(--hf-s-4) 0; }

.vfr-start { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.vfr-actions { display: flex; gap: var(--hf-s-2); justify-content: center; flex-wrap: wrap; }
.vfr-error {
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-err-muted);
  color: var(--hf-err);
  font-size: var(--hf-t-sm);
  text-align: center;
}
.vfr-ethics { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); text-align: center; margin-top: var(--hf-s-2); }

.vfr-running { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.vfr-running-label { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }
.vfr-skel { padding: var(--hf-s-3); background: var(--hf-surface-raised); border-radius: var(--hf-r-md); }

.vfr-report { display: flex; flex-direction: column; gap: var(--hf-s-4); }
.vfr-block { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.vfr-block-title {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted);
}
.vfr-summary { font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: 1.55; }
.vfr-list { display: flex; flex-direction: column; gap: var(--hf-s-2); list-style: none; padding: 0; margin: 0; }
.vfr-item { display: flex; gap: var(--hf-s-2); align-items: flex-start; font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: 1.5; }
.vfr-item :deep(.hf-chip) { flex: none; margin-top: 1px; }
.vfr-note { color: var(--hf-fg-muted); font-style: normal; }

.vfr-tl-row { display: flex; gap: var(--hf-s-3); font-size: var(--hf-t-sm); line-height: 1.5; }
.vfr-tl-period { flex: none; min-width: 110px; color: var(--hf-fg-muted); font-variant-numeric: tabular-nums; }
.vfr-tl-body { display: inline-flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; color: var(--hf-fg); min-width: 0; }
/* Длинный чип «пробел: …» должен переноситься, а не резаться на узкой панели */
.vfr-tl-body :deep(.hf-chip) { white-space: normal; height: auto; min-width: 0; max-width: 100%; }

.vfr-questions { display: flex; flex-direction: column; gap: var(--hf-s-2); padding-left: 1.2em; margin: 0; font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: 1.5; }
.vfr-meta { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); text-align: center; }
</style>
