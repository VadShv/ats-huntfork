/**
 * useOutreach — черновики сообщений кандидатам и шаблоны аутрича.
 *
 * Хранит черновики и шаблоны в chrome.storage.local.
 * Шаблоны поддерживают переменные: {{name}}, {{role}}, {{company}}, {{skill}}.
 * Отправка: Telegram → deep link t.me, Email → mailto:, LinkedIn → открытие вкладки.
 * UI + composables с заглушками, готовыми к подключению API Huntfork.
 */
import { ref, onMounted, computed } from 'vue'
import { useToast } from './useToast'
import { useHistory } from './useHistory'

export type OutreachChannel = 'telegram' | 'email' | 'linkedin'
export type DraftStatus = 'draft' | 'sent' | 'archived'

export interface DraftItem {
  id: string
  candidateName: string
  candidateHandle?: string
  role: string
  channel: OutreachChannel
  match: number
  preview: string
  body: string
  updatedAt: number
  status: DraftStatus
}

export interface OutreachTemplate {
  id: string
  name: string
  channel: OutreachChannel
  subject?: string
  body: string
  isBuiltIn: boolean
}

const DRAFTS_KEY = 'hf:outreach:drafts'
const TEMPLATES_KEY = 'hf:outreach:templates'

/** Встроенные шаблоны — стартовый набор. */
const BUILTIN_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'tpl_warm_tg',
    name: 'Тёплый первый контакт (Telegram)',
    channel: 'telegram',
    body: 'Здравствуйте, {{name}}! Обратил внимание на ваш опыт с {{skill}}. У нас сейчас открыт похожий вызов — {{role}}. Подскажите, было бы вам интересно обсудить?',
    isBuiltIn: true,
  },
  {
    id: 'tpl_warm_email',
    name: 'Тёплый первый контакт (Email)',
    channel: 'email',
    subject: 'Интересная возможность — {{role}}',
    body: 'Здравствуйте, {{name}}!\n\nОбратил внимание на ваш опыт с {{skill}}. У нас сейчас открыт похожий вызов — позиция {{role}} в {{company}}. Подскажите, было бы вам интересно обсудить детали?\n\nС уважением,\nРекрутёрская команда',
    isBuiltIn: true,
  },
  {
    id: 'tpl_linkedin',
    name: 'Короткое сообщение (LinkedIn)',
    channel: 'linkedin',
    body: 'Привет, {{name}}! Видел ваши кейсы по {{skill}} — очень близки к тому, что мы делаем. Открыта ли к разговору о новой роли {{role}}?',
    isBuiltIn: true,
  },
  {
    id: 'tpl_reactivation',
    name: 'Реактивация спящего контакта',
    channel: 'telegram',
    body: 'Здравствуйте, {{name}}! Мы общались ранее по другой вакансии. Сейчас появился новый вариант — {{role}}, и ваш профиль снова подходит. Был бы рад возобновить диалог.',
    isBuiltIn: true,
  },
]

/** Псевдо-данные для демонстрации UI. */
const SEED_DRAFTS: DraftItem[] = [
  {
    id: 'd_seed_1',
    candidateName: 'Анна Соколова',
    candidateHandle: 'anna_sokolova',
    role: 'Senior Frontend',
    channel: 'telegram',
    match: 88,
    preview: 'Здравствуйте, Анна! Ваш опыт с Vue 3 и архитектурой дизайн-систем…',
    body: 'Здравствуйте, Анна!\n\nОбратил внимание на ваш опыт с Vue 3 и проектированием дизайн-систем. У нас сейчас открыт похожий вызов — строим компонентную библиотеку с нуля. Подскажите, было бы вам интересно обсудить?',
    updatedAt: Date.now() - 5 * 60 * 1000,
    status: 'draft',
  },
  {
    id: 'd_seed_2',
    candidateName: 'Дмитрий Орлов',
    candidateHandle: 'dmitry.orlov',
    role: 'Tech Lead',
    channel: 'email',
    match: 72,
    preview: 'Добрый день, Дмитрий! Видел ваш переход из команды в команду…',
    body: 'Добрый день, Дмитрий!\n\nВидел, что вы вели команду из 8 человек и выстраивали процессы delivery. Хочу предложить роль техлида в продуктовой команде — расскажу подробнее?',
    updatedAt: Date.now() - 60 * 60 * 1000,
    status: 'draft',
  },
  {
    id: 'd_seed_3',
    candidateName: 'Мария Кузнецова',
    candidateHandle: 'maria_kuz',
    role: 'Product Designer',
    channel: 'linkedin',
    match: 64,
    preview: 'Привет, Мария! Ваши кейсы по B2B-дашбордам…',
    body: 'Привет, Мария!\n\nВаши кейсы по B2B-дашбордам очень близки к тому, что мы делаем. Открыта ли к разговору о новой роли?',
    updatedAt: Date.now() - 24 * 60 * 60 * 1000,
    status: 'draft',
  },
]

const drafts = ref<DraftItem[]>([])
const templates = ref<OutreachTemplate[]>([])
const loaded = ref(false)

export function useOutreach() {
  const { toast } = useToast()
  const { log } = useHistory()

  async function load() {
    if (loaded.value) return
    loaded.value = true
    try {
      const [dResult, tResult] = await chrome.storage.local.get([DRAFTS_KEY, TEMPLATES_KEY])
      drafts.value = Array.isArray(dResult[DRAFTS_KEY])
        ? dResult[DRAFTS_KEY]
        : SEED_DRAFTS
      templates.value = Array.isArray(tResult[TEMPLATES_KEY])
        ? [...BUILTIN_TEMPLATES, ...tResult[TEMPLATES_KEY]]
        : BUILTIN_TEMPLATES
      if (!Array.isArray(dResult[DRAFTS_KEY])) persistDrafts()
      if (!Array.isArray(tResult[TEMPLATES_KEY])) persistTemplates()
    } catch {
      drafts.value = SEED_DRAFTS
      templates.value = BUILTIN_TEMPLATES
    }
  }

  function persistDrafts() {
    try { chrome.storage.local.set({ [DRAFTS_KEY]: drafts.value }) } catch {}
  }

  function persistTemplates() {
    const custom = templates.value.filter((t) => !t.isBuiltIn)
    try { chrome.storage.local.set({ [TEMPLATES_KEY]: custom }) } catch {}
  }

  onMounted(() => {
    load()
  })

  /** Подстановка переменных в шаблон. */
  function applyTemplate(
    template: OutreachTemplate,
    candidate: { name?: string; role?: string; company?: string; skill?: string }
  ): string {
    let body = template.body
    body = body.replaceAll('{{name}}', candidate.name || 'кандидат')
    body = body.replaceAll('{{role}}', candidate.role || 'позицию')
    body = body.replaceAll('{{company}}', candidate.company || 'нашу компанию')
    body = body.replaceAll('{{skill}}', candidate.skill || 'вашим стеком')
    return body
  }

  /** Создать черновик из шаблона. */
  function createDraft(
    candidate: { name: string; handle?: string; role: string; match?: number; skill?: string },
    templateId: string
  ): DraftItem {
    const tpl = templates.value.find((t) => t.id === templateId)
    const body = tpl ? applyTemplate(tpl, candidate) : `Здравствуйте, ${candidate.name}!`
    const draft: DraftItem = {
      id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      candidateName: candidate.name,
      candidateHandle: candidate.handle,
      role: candidate.role,
      channel: tpl?.channel ?? 'telegram',
      match: candidate.match ?? 0,
      preview: body.slice(0, 80),
      body,
      updatedAt: Date.now(),
      status: 'draft',
    }
    drafts.value = [draft, ...drafts.value]
    persistDrafts()
    toast('Черновик создан', 'success')
    return draft
  }

  /** Обновить тело черновика. */
  function updateDraft(id: string, body: string) {
    const d = drafts.value.find((d) => d.id === id)
    if (d) {
      d.body = body
      d.preview = body.slice(0, 80)
      d.updatedAt = Date.now()
      persistDrafts()
    }
  }

  /** Удалить черновик. */
  function removeDraft(id: string) {
    drafts.value = drafts.value.filter((d) => d.id !== id)
    persistDrafts()
  }

  /** Отправить черновик через нужный канал. */
  function sendDraft(id: string): { url: string; channel: OutreachChannel } | null {
    const d = drafts.value.find((d) => d.id === id)
    if (!d) return null
    let url = ''
    if (d.channel === 'telegram' && d.candidateHandle) {
      url = `https://t.me/${d.candidateHandle}?text=${encodeURIComponent(d.body)}`
    } else if (d.channel === 'email') {
      const subject = d.preview.slice(0, 50)
      url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(d.body)}`
    } else if (d.channel === 'linkedin' && d.candidateHandle) {
      url = `https://www.linkedin.com/in/${d.candidateHandle}`
    } else {
      url = `https://t.me/${d.candidateName.replace(/\s+/g, '')}`
    }
    d.status = 'sent'
    d.updatedAt = Date.now()
    persistDrafts()
    log({
      type: 'outreach_send',
      description: `Отправлено сообщение (${d.channel}) — ${d.candidateName}`,
      candidateName: d.candidateName,
      url,
      meta: { channel: d.channel, match: d.match },
    })
    toast('Открываю канал отправки…', 'success')
    return { url, channel: d.channel }
  }

  /** Создать пользовательский шаблон. */
  function addTemplate(data: Omit<OutreachTemplate, 'id' | 'isBuiltIn'>): OutreachTemplate {
    const tpl: OutreachTemplate = {
      ...data,
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      isBuiltIn: false,
    }
    templates.value = [...templates.value, tpl]
    persistTemplates()
    toast('Шаблон создан', 'success')
    return tpl
  }

  /** Обновить шаблон (только пользовательский). */
  function updateTemplate(id: string, data: Partial<OutreachTemplate>) {
    const t = templates.value.find((t) => t.id === id)
    if (t && !t.isBuiltIn) {
      Object.assign(t, data)
      persistTemplates()
    }
  }

  /** Удалить шаблон (только пользовательский). */
  function removeTemplate(id: string) {
    const t = templates.value.find((t) => t.id === id)
    if (t && !t.isBuiltIn) {
      templates.value = templates.value.filter((t) => t.id !== id)
      persistTemplates()
      toast('Шаблон удалён', 'default')
    }
  }

  const activeDrafts = computed(() => drafts.value.filter((d) => d.status === 'draft'))
  const sentDrafts = computed(() => drafts.value.filter((d) => d.status === 'sent'))
  const customTemplates = computed(() => templates.value.filter((t) => !t.isBuiltIn))

  /** Лейбл канала. */
  function channelLabel(ch: OutreachChannel): string {
    if (ch === 'telegram') return 'Telegram'
    if (ch === 'email') return 'Email'
    return 'LinkedIn'
  }

  function fmtRelative(ts: number): string {
    const diff = Date.now() - ts
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'только что'
    if (min < 60) return `${min} мин назад`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} ч назад`
    return `${Math.floor(hr / 24)} д назад`
  }

  return {
    drafts,
    templates,
    activeDrafts,
    sentDrafts,
    customTemplates,
    load,
    createDraft,
    updateDraft,
    removeDraft,
    sendDraft,
    addTemplate,
    updateTemplate,
    removeTemplate,
    applyTemplate,
    channelLabel,
    fmtRelative,
    BUILTIN_TEMPLATES,
  }
}
