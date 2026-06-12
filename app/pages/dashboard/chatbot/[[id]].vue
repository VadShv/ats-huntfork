<script setup lang="ts">
import {
  Sparkles, Send, Square, Paperclip, FileText, X, Brain,
  Briefcase, Globe, ChevronDown, Loader2, User2, Wrench, AlertCircle,
  Check, BookOpen, PanelRightClose, PanelRightOpen,
} from 'lucide-vue-next'
import MarkdownDescription from '~/components/MarkdownDescription.vue'

const { t } = useI18n()

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
  fullbleed: true,
})

useSeoMeta({
  title: () => t('assistant.title'),
  robots: 'noindex, nofollow',
})

const {
  messages,
  pendingAttachments,
  scope,
  thinking,
  isStreaming,
  loadingConversation,
  error,
  sources,
  currentConversationId,
  send,
  abort,
  uploadFile,
  removeAttachment,
  loadAll,
  newConversation,
  openConversation,
} = useChatbot()

const route = useRoute()
const router = useRouter()

// ── URL ↔ conversation id sync ──
// The route is /dashboard/chatbot or /dashboard/chatbot/:id. Whenever the URL
// changes (initial load, browser back/forward, sidebar click), reflect it in
// composable state. Whenever the active conversation changes (e.g. starting a
// new chat), reflect it in the URL so each chat has its own shareable link.
function routeId(): string | null {
  const raw = route.params.id
  const id = Array.isArray(raw) ? raw[0] : raw
  return id ? id : null
}

async function syncFromRoute() {
  const id = routeId()
  if (id) {
    if (currentConversationId.value !== id) {
      await openConversation(id)
    }
  }
  else if (currentConversationId.value !== null) {
    // URL has no id — clear the open conversation so the empty state shows.
    currentConversationId.value = null
    messages.value = []
    sources.value = []
  }
}

watch(currentConversationId, (id) => {
  const current = routeId()
  if (id && current !== id) {
    void router.replace(`/dashboard/chatbot/${id}`)
  }
  else if (!id && current) {
    void router.replace('/dashboard/chatbot')
  }
})

watch(() => route.params.id, () => { void syncFromRoute() })

// ── Initial load ──
onMounted(async () => {
  await loadAll()
  await syncFromRoute()
})

// ── Jobs for the scope picker ──
const { data: jobsData } = await useFetch('/api/jobs', {
  key: 'chatbot-jobs',
  query: { limit: 100 },
  headers: useRequestHeaders(['cookie']),
})
const jobs = computed(() => (jobsData.value?.data ?? []) as Array<{ id: string; title: string; status: string }>)
const selectedJob = computed(() =>
  scope.value.kind === 'job' ? jobs.value.find((j) => j.id === scope.value.jobId) ?? null : null,
)

const showScopePicker = ref(false)
const scopeMenuRef = useTemplateRef<HTMLElement>('scopeMenuRoot')
function onClickOutside(e: MouseEvent) {
  if (scopeMenuRef.value && !scopeMenuRef.value.contains(e.target as Node)) {
    showScopePicker.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

function selectScope(kind: 'organization' | 'job', jobId?: string) {
  scope.value = kind === 'organization' ? { kind } : { kind, jobId }
  showScopePicker.value = false
}

// ── Composer ──
const draft = ref('')
const composerRef = useTemplateRef<HTMLTextAreaElement>('composer')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')

function autoResize() {
  const el = composerRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`
}
watch(draft, () => nextTick(autoResize))

async function handleSubmit() {
  if (isStreaming.value) return
  const content = draft.value
  draft.value = ''
  await nextTick(autoResize)
  await send(content)
  await nextTick(scrollToBottom)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void handleSubmit()
  }
}

const uploading = ref(false)
async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    for (const f of files) await uploadFile(f)
  } finally {
    uploading.value = false
  }
}

// ── Auto-scroll on incoming chunks ──
const scrollerRef = useTemplateRef<HTMLElement>('scroller')
function scrollToBottom() {
  const el = scrollerRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
watch(
  () => messages.value.map((m) => m.content.length + (m.reasoning?.length ?? 0) + (m.toolCalls?.length ?? 0)).join(','),
  () => nextTick(scrollToBottom),
)
watch(currentConversationId, () => nextTick(scrollToBottom))

// ── Suggestions for empty state ──
const suggestions = computed(() => {
  if (selectedJob.value) {
    const job = selectedJob.value.title
    return [
      t('assistant.suggestions.job.top', { job }),
      t('assistant.suggestions.job.compare', { job }),
      t('assistant.suggestions.job.stalled', { job }),
      t('assistant.suggestions.job.shortlist', { job }),
    ]
  }
  return [
    t('assistant.suggestions.org.strongest_pool'),
    t('assistant.suggestions.org.stuck'),
    t('assistant.suggestions.org.backend'),
    t('assistant.suggestions.org.month_summary'),
  ]
})

function applySuggestion(s: string) {
  draft.value = s
  nextTick(() => composerRef.value?.focus())
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toolLabel(name: string) {
  return name.replace(/_/g, ' ')
}

// ── Right-rail sources panel + Agent manager ──
const sourcesOpen = ref(false)
const agentsOpen = ref(false)

// Auto-open sources panel the first time a citation arrives.
let sourcesAutoOpened = false
watch(() => sources.value.length, (n) => {
  if (n > 0 && !sourcesAutoOpened) {
    sourcesAutoOpened = true
    sourcesOpen.value = true
  }
})

async function startNew() {
  await newConversation()
}
</script>

<template>
  <div class="flex h-full overflow-hidden bg-white dark:bg-surface-950">
    <!-- Left rail: folders + conversations -->
    <ChatbotSidebar @open-agents="agentsOpen = true" />

    <!-- Center: chat -->
    <main class="flex flex-1 min-w-0 flex-col">
      <!-- Header strip -->
      <header class="flex items-center justify-between gap-3 border-b border-surface-200 dark:border-surface-800 px-4 h-14 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="min-w-0">
            <h1 class="truncate text-sm font-semibold tracking-tight text-surface-900 dark:text-surface-100">
              {{ t('assistant.title') }}
            </h1>
            <p class="truncate text-[11px] text-surface-500 dark:text-surface-400">
              {{ t('assistant.subtitle') }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Scope picker -->
          <div ref="scopeMenuRoot" class="relative">
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer"
              @click="showScopePicker = !showScopePicker"
            >
              <component :is="scope.kind === 'job' ? Briefcase : Globe" class="size-3.5 text-brand-500" />
              <span class="max-w-[160px] truncate">
                {{ scope.kind === 'job' ? (selectedJob?.title ?? t('assistant.scope.select_job')) : t('assistant.scope.organization') }}
              </span>
              <ChevronDown class="size-3 text-surface-400" :class="showScopePicker ? 'rotate-180' : ''" />
            </button>

            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 scale-95 -translate-y-1"
              enter-to-class="opacity-100 scale-100 translate-y-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 scale-100 translate-y-0"
              leave-to-class="opacity-0 scale-95 -translate-y-1"
            >
              <div
                v-if="showScopePicker"
                class="absolute right-0 top-[calc(100%+6px)] z-30 w-72 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl"
              >
                <div class="border-b border-surface-100 dark:border-surface-800 px-4 py-2.5">
                  <p class="text-[11px] font-semibold uppercase tracking-wider text-surface-500">
                    {{ t('assistant.scope.label') }}
                  </p>
                </div>
                <button
                  class="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-brand-50 dark:hover:bg-brand-950/30 cursor-pointer border-0 bg-transparent"
                  @click="selectScope('organization')"
                >
                  <Globe class="mt-0.5 size-4 text-brand-500" />
                  <div class="flex-1">
                    <div class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ t('assistant.scope.organization') }}</div>
                    <div class="text-xs text-surface-500">{{ t('assistant.scope.organization_desc') }}</div>
                  </div>
                  <Check v-if="scope.kind === 'organization'" class="size-4 text-brand-500" />
                </button>
                <div class="max-h-72 overflow-y-auto border-t border-surface-100 dark:border-surface-800 py-1">
                  <p v-if="jobs.length === 0" class="px-4 py-3 text-xs text-surface-500">
                    {{ t('assistant.scope.no_jobs') }}
                  </p>
                  <button
                    v-for="j in jobs"
                    :key="j.id"
                    class="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-brand-50 dark:hover:bg-brand-950/30 cursor-pointer border-0 bg-transparent"
                    @click="selectScope('job', j.id)"
                  >
                    <Briefcase class="mt-0.5 size-4 text-surface-400" />
                    <div class="flex-1 min-w-0">
                      <div class="truncate text-sm text-surface-900 dark:text-surface-100">{{ j.title }}</div>
                      <div class="text-xs text-surface-500 capitalize">{{ j.status }}</div>
                    </div>
                    <Check v-if="scope.kind === 'job' && scope.jobId === j.id" class="size-4 text-brand-500" />
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Thinking toggle -->
          <button
            class="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
            :class="thinking
              ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
              : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800'"
            :title="thinking ? t('assistant.thinking_on') : t('assistant.thinking_off')"
            @click="thinking = !thinking"
          >
            <Brain class="size-3.5" />
            {{ t('assistant.thinking') }}
          </button>

          <!-- Sources panel toggle -->
          <button
            class="inline-flex items-center justify-center size-8 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-500 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/30 transition-colors cursor-pointer relative"
            :title="sourcesOpen ? t('assistant.sources.hide') : t('assistant.sources.show')"
            @click="sourcesOpen = !sourcesOpen"
          >
            <component :is="sourcesOpen ? PanelRightClose : PanelRightOpen" class="size-3.5" />
            <span
              v-if="sources.length > 0 && !sourcesOpen"
              class="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-brand-600 text-[9px] font-semibold text-white"
            >
              {{ Math.min(sources.length, 99) }}
            </span>
          </button>
        </div>
      </header>

      <!-- Loading state when switching conversations -->
      <div
        v-if="loadingConversation"
        class="flex flex-1 items-center justify-center text-sm text-surface-500"
      >
        <Loader2 class="mr-2 size-4 animate-spin" />
        {{ t('assistant.loading') }}
      </div>

      <!-- Conversation -->
      <div
        v-else
        ref="scroller"
        class="relative flex-1 min-h-0 overflow-y-auto"
      >
        <!-- Empty state -->
        <div v-if="messages.length === 0" class="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 py-12 text-center">
          <Sparkles class="size-10 text-brand-500" />
          <h2 class="mt-5 text-xl font-semibold text-surface-900 dark:text-surface-100">
            {{ t('assistant.empty_title') }}
          </h2>
          <p class="mt-2 max-w-md text-sm text-surface-500">
            {{ t('assistant.empty_subtitle') }}
          </p>
          <div class="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="s in suggestions"
              :key="s"
              class="group rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-3 text-left text-sm text-surface-700 dark:text-surface-300 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50/40 dark:hover:bg-brand-950/30 transition-colors cursor-pointer"
              @click="applySuggestion(s)"
            >
              <span class="line-clamp-2">{{ s }}</span>
            </button>
          </div>
        </div>

        <!-- Messages -->
        <div v-else class="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-8">
          <div
            v-for="m in messages"
            :key="m.id"
            class="flex gap-3"
            :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              v-if="m.role === 'assistant'"
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white mt-2"
              :aria-label="t('assistant.title')"
            >
              <Sparkles class="size-5" />
            </div>

            <div :class="m.role === 'user' ? 'max-w-[85%]' : 'max-w-[85%] flex-1'">
              <div
                v-if="m.role === 'user'"
                class="rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm shadow-brand-600/20"
              >
                <div class="whitespace-pre-wrap">{{ m.content }}</div>
                <div v-if="m.attachments?.length" class="mt-2 flex flex-wrap gap-1.5 border-t border-white/15 pt-2">
                  <span
                    v-for="a in m.attachments"
                    :key="a.id"
                    class="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs"
                  >
                    <FileText class="size-3" />
                    {{ a.filename }}
                  </span>
                </div>
              </div>

              <div v-else class="space-y-2">
                <details
                  v-if="m.reasoning"
                  class="group rounded-lg border border-violet-200/60 dark:border-violet-800/60 bg-violet-50/50 dark:bg-violet-950/20 px-3 py-2 text-xs text-violet-700 dark:text-violet-300"
                >
                  <summary class="flex cursor-pointer items-center gap-1.5 font-medium">
                    <Brain class="size-3.5" />
                    {{ t('assistant.thinking') }}
                    <ChevronDown class="size-3 transition-transform group-open:rotate-180" />
                  </summary>
                  <div class="mt-2 whitespace-pre-wrap leading-relaxed opacity-90">
                    {{ m.reasoning }}
                  </div>
                </details>

                <details
                  v-if="m.toolCalls?.length"
                  class="group rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-800/40 text-xs"
                >
                  <summary class="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-1.5 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
                    <Wrench class="size-3.5 shrink-0" />
                    <span class="flex-1 font-medium">
                      {{ m.toolCalls.length === 1 ? t('assistant.tool_calls.one') : t('assistant.tool_calls.many', { n: m.toolCalls.length }) }}
                    </span>
                    <ChevronDown class="size-3 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <div class="space-y-1 border-t border-surface-200 dark:border-surface-800 px-2 py-2">
                    <div
                      v-for="tc in m.toolCalls"
                      :key="tc.id"
                      class="flex items-start gap-2 rounded-md px-2 py-1.5"
                    >
                      <component
                        :is="tc.status === 'pending' ? Loader2 : tc.status === 'error' ? AlertCircle : Wrench"
                        class="mt-0.5 size-3.5 shrink-0"
                        :class="[
                          tc.status === 'pending' && 'animate-spin text-brand-500',
                          tc.status === 'success' && 'text-emerald-600 dark:text-emerald-400',
                          tc.status === 'error' && 'text-danger-500',
                        ]"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="font-medium text-surface-700 dark:text-surface-200 capitalize">
                          {{ toolLabel(tc.name) }}
                        </div>
                        <div
                          v-if="tc.status === 'error'"
                          class="mt-0.5 text-danger-600 dark:text-danger-400"
                        >
                          {{ (tc.output as { error?: string })?.error ?? 'Ошибка' }}
                        </div>
                      </div>
                    </div>
                  </div>
                </details>

                <div
                  v-if="m.content"
                  class="px-1 py-1 text-sm text-surface-800 dark:text-surface-200"
                >
                  <MarkdownDescription :value="m.content" />
                </div>
                <div
                  v-else-if="isStreaming && m.id === messages[messages.length - 1]?.id"
                  class="inline-flex items-center gap-2 px-1 py-3 text-sm text-surface-500"
                >
                  <span class="flex gap-1">
                    <span class="size-1.5 animate-bounce rounded-full bg-brand-500" style="animation-delay: 0ms" />
                    <span class="size-1.5 animate-bounce rounded-full bg-brand-500" style="animation-delay: 150ms" />
                    <span class="size-1.5 animate-bounce rounded-full bg-brand-500" style="animation-delay: 300ms" />
                  </span>
                  {{ t('assistant.thinking') }}…
                </div>

                <!-- Inline source citations on assistant message -->
                <div
                  v-if="m.sources?.length"
                  class="mt-2 flex flex-wrap gap-1.5 border-t border-surface-100 dark:border-surface-800 pt-2"
                >
                  <span class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
                    <BookOpen class="size-3" />
                    {{ t('assistant.sources.title') }}
                  </span>
                  <span
                    v-for="s in m.sources"
                    :key="s.id"
                    class="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2 py-0.5 text-[11px] text-surface-700 dark:text-surface-300"
                    :title="`${s.kind}: ${s.label}`"
                  >
                    <span class="truncate">{{ s.label }}</span>
                  </span>
                </div>
              </div>
            </div>

            <div
              v-if="m.role === 'user'"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-200 dark:bg-surface-800 text-surface-700 dark:text-surface-300"
            >
              <User2 class="size-4" />
            </div>
          </div>
        </div>
      </div>

      <!-- Composer -->
      <div class="border-t border-surface-200 dark:border-surface-800 px-4 py-3 sm:px-6">
        <div class="mx-auto w-full max-w-3xl">
          <div
            class="rounded-2xl border border-surface-200/80 dark:border-surface-800/80 bg-white dark:bg-surface-900 shadow-sm focus-within:border-brand-400 dark:focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-500/10 transition-all"
          >
            <div
              v-if="pendingAttachments.length > 0"
              class="flex flex-wrap gap-1.5 border-b border-surface-100 dark:border-surface-800 px-3 py-2"
            >
              <div
                v-for="a in pendingAttachments"
                :key="a.id"
                class="group inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-2 py-1 text-xs"
              >
                <FileText class="size-3.5 text-brand-500" />
                <span class="max-w-[160px] truncate font-medium">{{ a.filename }}</span>
                <span class="text-surface-400">{{ formatBytes(a.sizeBytes) }}</span>
                <button
                  class="ml-1 inline-flex items-center justify-center rounded p-0.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-danger-500 transition-colors cursor-pointer border-0 bg-transparent"
                  :aria-label="t('assistant.composer.remove_attachment', { name: a.filename })"
                  @click="removeAttachment(a.id)"
                >
                  <X class="size-3" />
                </button>
              </div>
            </div>

            <textarea
              ref="composer"
              v-model="draft"
              rows="1"
              :placeholder="t('assistant.composer.placeholder')"
              class="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-0"
              @keydown="onKeyDown"
            />

            <div class="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
              <div class="flex items-center gap-1.5">
                <input
                  ref="fileInput"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  multiple
                  class="hidden"
                  @change="handleFileChange"
                />
                <button
                  class="inline-flex items-center justify-center size-8 rounded-lg text-surface-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors cursor-pointer border-0 bg-transparent disabled:opacity-50"
                  :title="t('assistant.composer.attach')"
                  :disabled="uploading"
                  @click="fileInputRef?.click()"
                >
                  <Loader2 v-if="uploading" class="size-4 animate-spin" />
                  <Paperclip v-else class="size-4" />
                </button>

                <ChatbotAgentPicker @manage="agentsOpen = true" />
                <ChatbotModelPicker @manage="navigateTo('/dashboard/settings/ai')" />
              </div>

              <div class="flex items-center gap-2">
                <button
                  v-if="isStreaming"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-surface-900 dark:bg-surface-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-surface-900 hover:opacity-90 transition-opacity cursor-pointer border-0"
                  @click="abort"
                >
                  <Square class="size-3.5 fill-current" />
                  {{ t('assistant.composer.stop') }}
                </button>
                <button
                  v-else
                  class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700 transition-colors cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!draft.trim() && pendingAttachments.length === 0"
                  @click="handleSubmit"
                >
                  <Send class="size-3.5" />
                  {{ t('assistant.composer.send') }}
                </button>
              </div>
            </div>
          </div>

          <p
            v-if="error"
            class="mt-2 flex items-center gap-1.5 text-xs text-danger-600"
          >
            <AlertCircle class="size-3.5" />
            {{ error }}
          </p>
          <p v-else class="mt-2 text-center text-[11px] text-surface-400">
            {{ t('assistant.disclaimer') }}
          </p>
        </div>
      </div>
    </main>

    <!-- Right rail: sources -->
    <ChatbotSourcesPanel :open="sourcesOpen" @close="sourcesOpen = false" />

    <!-- Agent manager modal -->
    <ChatbotAgentManagerModal :open="agentsOpen" @close="agentsOpen = false" />
  </div>
</template>
