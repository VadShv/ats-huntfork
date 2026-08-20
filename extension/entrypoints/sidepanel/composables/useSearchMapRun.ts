/**
 * useSearchMapRun — реальная карта поиска через серверный ИИ (П6).
 *
 * POST /api/extension/search-map: по вакансии из ATS (jobId) или по
 * названию/описанию строится карта: профиль, доноры, гипотезы,
 * готовые запросы по площадкам и анти-ключи.
 */
import { ref, computed } from 'vue'
import { useSidekick, useSidekickActions } from './useSidekick'
import { useToast } from './useToast'

export type SmRunState = 'idle' | 'running' | 'done' | 'error'

export interface SmDonor { company: string, why: string }
export interface SmHypothesis { title: string, description: string, channels: string[] }
export interface SmQuery { platform: string, query: string, note?: string }

export interface SmMap {
  profileSummary: string
  donors: SmDonor[]
  hypotheses: SmHypothesis[]
  queries: SmQuery[]
  antiKeywords: string[]
}

const state = ref<SmRunState>('idle')
const map = ref<SmMap | null>(null)
const meta = ref<{ provider: string | null, model: string | null, generatedAt: string } | null>(null)
const errorMsg = ref('')
const builtForJob = ref<string | null>(null)

export const SM_PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  habr: 'Хабр Карьера',
  hh: 'hh.ru',
  web: 'Веб / X-Ray',
  telegram: 'Telegram',
  events: 'Конференции',
}

export function useSearchMapRun() {
  const { selectedJobId, jobs } = useSidekick()
  const { send } = useSidekickActions()
  const { toast } = useToast()

  const selectedJob = computed(() => jobs.value.find((j: any) => j.id === selectedJobId.value) ?? null)

  async function run() {
    if (state.value === 'running') return
    if (!selectedJobId.value) {
      errorMsg.value = 'Выберите вакансию — карта строится по её описанию из ATS.'
      state.value = 'error'
      return
    }
    state.value = 'running'
    errorMsg.value = ''
    const resp = await send({ type: 'searchMap', jobId: selectedJobId.value })
    if (resp?.ok && resp.data?.map) {
      map.value = resp.data.map
      meta.value = resp.data.meta ?? null
      builtForJob.value = selectedJobId.value
      state.value = 'done'
    }
    else {
      errorMsg.value = resp?.message || 'Не удалось построить карту поиска'
      state.value = 'error'
    }
  }

  function reset() {
    state.value = 'idle'
    map.value = null
    errorMsg.value = ''
    builtForJob.value = null
  }

  function exportMarkdown(): string {
    const m = map.value
    if (!m) return ''
    const lines: string[] = ['## Карта поиска (Sidekick)', '', m.profileSummary, '']
    if (m.donors.length) {
      lines.push('### Компании-доноры')
      m.donors.forEach(d => lines.push(`- **${d.company}** — ${d.why}`))
      lines.push('')
    }
    if (m.hypotheses.length) {
      lines.push('### Гипотезы поиска')
      m.hypotheses.forEach(h => lines.push(`- **${h.title}** — ${h.description}${h.channels.length ? ` (каналы: ${h.channels.join(', ')})` : ''}`))
      lines.push('')
    }
    if (m.queries.length) {
      lines.push('### Поисковые запросы')
      m.queries.forEach((q, i) => {
        lines.push(`${i + 1}. ${SM_PLATFORM_LABELS[q.platform] ?? q.platform}${q.note ? ` — ${q.note}` : ''}`)
        lines.push('```', q.query, '```', '')
      })
    }
    if (m.antiKeywords.length) {
      lines.push('### Анти-ключи', m.antiKeywords.map(k => `\`${k}\``).join(', '), '')
    }
    return lines.join('\n')
  }

  async function copyQuery(q: SmQuery) {
    try {
      await navigator.clipboard.writeText(q.query)
      toast('Запрос скопирован', 'success')
    } catch {}
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(exportMarkdown())
      toast('Карта скопирована', 'success')
    } catch {}
  }

  return {
    state, map, meta, errorMsg, builtForJob, selectedJob,
    run, reset, exportMarkdown, copyQuery, copyAll,
  }
}
