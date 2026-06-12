<script setup lang="ts">
import { ArrowLeft, Upload, FileText, Loader2, X, Users, AlertTriangle, ExternalLink, Building2 } from 'lucide-vue-next'
import { z } from 'zod'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Add Candidate',
  description: 'Add a new candidate to your talent pool',
})

const localePath = useLocalePath()
const { createCandidate } = useCandidates()
const { track } = useTrack()
const { t } = useI18n()
const toast = useToast()

// ─────────────────────────────────────────────
// Resume file state
// ─────────────────────────────────────────────

const resumeFile = ref<File | null>(null)
const isParsing = ref(false)
const dropzoneActive = ref(false)
const resumeInputRef = ref<HTMLInputElement | null>(null)

// ─────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────

const form = ref({
  firstName: '',
  lastName: '',
  displayName: '',
  email: '',
  phone: '',
  gender: '' as '' | 'male' | 'female' | 'other' | 'prefer_not_to_say',
  dateOfBirth: '',
  // Sprint 3.3 (P2.2): явный город для более точного fuzzy-дедупа
  city: '',
  // Sprint 3.4 (P2.3): social-идентификаторы
  linkedin: '',
  telegram: '',
  github: '',
})

// Source field — UI only, not persisted to DB yet
const selectedSource = ref<string>('')

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const submitError = ref<string | null>(null)

// ─────────────────────────────────────────────
// Source options
// ─────────────────────────────────────────────

const sourceOptions = computed(() => [
  { value: '', label: t('candidate.new.sourcePlaceholder') },
  { value: 'hh.ru', label: t('candidate.new.sourceHhRu') },
  { value: 'linkedin', label: t('candidate.new.sourceLinkedIn') },
  { value: 'telegram', label: t('candidate.new.sourceTelegram') },
  { value: 'github', label: t('candidate.new.sourceGitHub') },
  { value: 'referral', label: t('candidate.new.sourceReferral') },
  { value: 'personal_base', label: t('candidate.new.sourcePersonalBase') },
  { value: 'other', label: t('candidate.new.sourceOther') },
])

// ─────────────────────────────────────────────
// Duplicate detection — live check
// ─────────────────────────────────────────────

interface ExactDup {
  kind: 'email' | 'phone'
  candidateId: string
  organizationId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  crossOrg: boolean
}
interface FuzzyDup {
  candidateId: string
  organizationId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  score: number
  signals: { name: number; city: number; dob: number }
  crossOrg: boolean
}

const checkLoading = ref(false)
const dupResult = ref<{ exact: ExactDup[]; fuzzy: FuzzyDup[] } | null>(null)
let lastWarnedToastKey = ''

const hasExact = computed(() => !!dupResult.value?.exact.length)
const hasHighFuzzy = computed(() => (dupResult.value?.fuzzy ?? []).some(f => f.score >= 95))
const hasAnyDup = computed(() => hasExact.value || (dupResult.value?.fuzzy.length ?? 0) > 0)

// Confirm modal state for fuzzy ≥95
const showConfirmModal = ref(false)
// Modal state for exact-dup (email/phone) — hard блок, предлагаем открыть существующего
const showExactDupModal = ref(false)

// Debounced check
let checkTimer: ReturnType<typeof setTimeout> | null = null

async function runDuplicateCheck() {
  // Only trigger when there's enough data: at least last name OR email OR phone
  const lastName = form.value.lastName.trim()
  const email = form.value.email.trim()
  const phone = form.value.phone.trim()
  if (!lastName && !email && !phone) {
    dupResult.value = null
    return
  }
  checkLoading.value = true
  try {
    const res = await $fetch<{ exact: ExactDup[]; fuzzy: FuzzyDup[] }>(
      '/api/candidates/check-duplicates',
      {
        method: 'POST',
        body: {
          firstName: form.value.firstName || null,
          lastName: form.value.lastName || null,
          email: form.value.email || null,
          phone: form.value.phone || null,
          dateOfBirth: form.value.dateOfBirth || null,
        },
      },
    )
    dupResult.value = res

    // Toast (one-shot) при наличии fuzzy 85-94 (без hard блока)
    const onlyMidFuzzy = !res.exact.length && res.fuzzy.length > 0 && !res.fuzzy.some(f => f.score >= 95)
    if (onlyMidFuzzy) {
      const key = res.fuzzy.map(f => f.candidateId).join(',')
      if (key !== lastWarnedToastKey) {
        lastWarnedToastKey = key
        toast.info?.(t('candidate.new.dedup.toastWarning'))
      }
    }
  } catch (e) {
    // silent — это live-проверка, не критично
    console.error('[dedup check] failed:', e)
  } finally {
    checkLoading.value = false
  }
}

watch(
  () => [form.value.firstName, form.value.lastName, form.value.email, form.value.phone, form.value.dateOfBirth],
  () => {
    if (checkTimer) clearTimeout(checkTimer)
    checkTimer = setTimeout(runDuplicateCheck, 500)
  },
  { deep: true },
)

function fullName(c: { firstName: string | null; lastName: string | null }) {
  return [c.lastName, c.firstName].filter(Boolean).join(' ') || '—'
}

// ─────────────────────────────────────────────
// Resume parsing
// ─────────────────────────────────────────────

async function handleResumeFile(file: File) {
  resumeFile.value = file
  isParsing.value = true

  try {
    const fd = new FormData()
    fd.append('file', file)

    const result = await $fetch<{
      firstName?: string
      lastName?: string
      displayName?: string
      email?: string
      phone?: string
      textPreview: string
      wordCount: number
      sourceFormat: string
    }>('/api/documents/parse-preview', {
      method: 'POST',
      body: fd,
    })

    let anyFilled = false
    if (result.firstName && !form.value.firstName) {
      form.value.firstName = result.firstName
      anyFilled = true
    }
    if (result.lastName && !form.value.lastName) {
      form.value.lastName = result.lastName
      anyFilled = true
    }
    if (result.displayName && !form.value.displayName) {
      form.value.displayName = result.displayName
      anyFilled = true
    }
    if (result.email && !form.value.email) {
      form.value.email = result.email
      anyFilled = true
    }
    if (result.phone && !form.value.phone) {
      form.value.phone = result.phone
      anyFilled = true
    }

    const hasContacts = !!(result.firstName || result.lastName || result.email || result.phone)
    if (hasContacts) {
      toast.success(t('candidate.new.parsedSuccess'))
    } else {
      toast.info(t('candidate.new.parsedNoContacts'))
    }
  } catch {
    toast.error(t('candidate.new.parseError'))
  } finally {
    isParsing.value = false
  }
}

function triggerResumeSelect() {
  resumeInputRef.value?.click()
}

function onResumeInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleResumeFile(file)
  input.value = ''
}

function removeResume() {
  resumeFile.value = null
  if (resumeInputRef.value) resumeInputRef.value.value = ''
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dropzoneActive.value = true
}

function onDragLeave() {
  dropzoneActive.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dropzoneActive.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleResumeFile(file)
}

// ─────────────────────────────────────────────
// Form validation
// ─────────────────────────────────────────────

const formSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(200).optional(),
  email: z.string().min(1, 'Email is required').email('Invalid email address').max(255),
  phone: z.string().max(50).optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .refine((v) => {
      const d = new Date(v)
      return !isNaN(d.getTime()) && d.getFullYear() >= 1900 && d <= new Date()
    }, 'Must be a valid past date')
    .optional(),
  // Sprint 3.3 (P2.2): город — свободный текст до 100 символов, опциональный
  city: z.string().max(100).optional(),
  // Sprint 3.4 (P2.3): social-идентификаторы
  linkedin: z.string().max(255).optional(),
  telegram: z.string().max(100).optional(),
  github: z.string().max(100).optional(),
})

function validate(): boolean {
  const result = formSchema.safeParse({
    ...form.value,
    gender: form.value.gender || undefined,
    dateOfBirth: form.value.dateOfBirth || undefined,
    displayName: form.value.displayName || undefined,
    city: form.value.city || undefined,
    linkedin: form.value.linkedin || undefined,
    telegram: form.value.telegram || undefined,
    github: form.value.github || undefined,
  })
  if (!result.success) {
    errors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) errors.value[field] = issue.message
    }
    return false
  }
  errors.value = {}
  return true
}

// ─────────────────────────────────────────────
// Submit
// ─────────────────────────────────────────────

async function doSubmit(force = false) {
  submitError.value = null
  if (!validate()) return

  // Жёсткий блок exact на клиенте: показываем модалку с предложением открыть существующего
  if (hasExact.value) {
    showExactDupModal.value = true
    return
  }

  isSubmitting.value = true
  try {
    const newCandidate = await createCandidate({
      firstName: form.value.firstName,
      lastName: form.value.lastName,
      displayName: form.value.displayName || undefined,
      email: form.value.email,
      phone: form.value.phone || undefined,
      gender: (form.value.gender as 'male' | 'female' | 'other' | 'prefer_not_to_say') || undefined,
      dateOfBirth: form.value.dateOfBirth || undefined,
      city: form.value.city || undefined,
      linkedin: form.value.linkedin || undefined,
      telegram: form.value.telegram || undefined,
      github: form.value.github || undefined,
      force,
    })

    track('candidate_added')

    if (resumeFile.value && newCandidate?.id) {
      try {
        const fd = new FormData()
        fd.append('file', resumeFile.value)
        fd.append('type', 'resume')
        await $fetch(`/api/candidates/${newCandidate.id}/documents`, {
          method: 'POST',
          body: fd,
        })
      } catch {
        toast.error(t('candidate.new.candidateCreatedResumeFailed'))
      }
    }

    const targetId = newCandidate?.id
    if (targetId) {
      await navigateTo(localePath(`/dashboard/candidates/${targetId}`))
    } else {
      await navigateTo(localePath('/dashboard/candidates'))
    }
  } catch (err: any) {
    const code = err.data?.data?.code ?? err.data?.code
    const message = err.data?.statusMessage ?? err.data?.data?.message ?? 'Something went wrong'

    if (err.statusCode === 409 || err.data?.statusCode === 409) {
      if (code === 'duplicate_exact') {
        // hard блок: показываем модалку с предложением открыть существующего
        const serverDupes = err.data?.data
        if (serverDupes) {
          dupResult.value = { exact: serverDupes.exact ?? [], fuzzy: serverDupes.fuzzy ?? [] }
        }
        showExactDupModal.value = true
      } else if (code === 'duplicate_fuzzy') {
        // открываем модалку подтверждения
        const serverDupes = err.data?.data
        if (serverDupes) {
          dupResult.value = { exact: serverDupes.exact ?? [], fuzzy: serverDupes.fuzzy ?? [] }
        }
        showConfirmModal.value = true
      } else {
        // legacy email-conflict
        errors.value.email = message
      }
    } else {
      submitError.value = message
    }
  } finally {
    isSubmitting.value = false
  }
}

function handleSubmit() {
  doSubmit(false)
}

function confirmAndCreate() {
  showConfirmModal.value = false
  doSubmit(true)
}

async function openExistingDup() {
  const first = dupResult.value?.exact[0]
  if (!first) {
    showExactDupModal.value = false
    return
  }
  showExactDupModal.value = false
  await navigateTo(localePath(`/dashboard/candidates/${first.candidateId}`))
}

// P1.3: «Дополнить существующего» — берёт данные из формы и заполняет пустые поля у найденного кандидата.
const isEnriching = ref(false)
async function enrichExistingDup() {
  const first = dupResult.value?.exact.find(e => !e.crossOrg) // только в своей org
  if (!first) {
    showExactDupModal.value = false
    return
  }
  if (isEnriching.value) return
  isEnriching.value = true
  try {
    const body: Record<string, unknown> = {}
    if (form.value.phone?.trim()) body.phone = form.value.phone.trim()
    if (form.value.gender && form.value.gender !== '') body.gender = form.value.gender
    if (form.value.dateOfBirth?.trim()) body.dateOfBirth = form.value.dateOfBirth.trim()

    const result: any = await $fetch(`/api/candidates/${first.candidateId}/enrich`, {
      method: 'POST',
      body,
    })
    const added: string[] = result?.added ?? []
    if (added.length === 0) {
      toast.warning?.(t('candidate.new.dedup.enrichNothing'))
    }
    else {
      toast.success?.(`${t('candidate.new.dedup.enrichSuccess')}: ${added.join(', ')}`)
    }
    showExactDupModal.value = false
    await navigateTo(localePath(`/dashboard/candidates/${first.candidateId}`))
  }
  catch (err: any) {
    submitError.value = err.data?.statusMessage || err.message || 'Не удалось дополнить карточку'
  }
  finally {
    isEnriching.value = false
  }
}

// Доступен ли enrich: хотя бы 1 экзачный дубль в своей org И в форме есть хотя бы 1 поле для передачи
const canEnrichExisting = computed(() => {
  const hasOwnOrgDup = (dupResult.value?.exact ?? []).some(e => !e.crossOrg)
  const hasNewData = !!(form.value.phone?.trim() || (form.value.gender && form.value.gender !== '') || form.value.dateOfBirth?.trim())
  return hasOwnOrgDup && hasNewData
})

// Не блокируем кнопку — пускаем submit, он покажет модалку при exact dup
const isSubmitDisabled = computed(() => isSubmitting.value || isParsing.value)

function candidateLink(id: string) {
  return localePath(`/dashboard/candidates/${id}`)
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      {{ $t('dashboard.candidates.addForm.back') }}
    </NuxtLink>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">{{ $t('dashboard.candidates.addForm.title') }}</h1>

    <!-- Two-column layout: form + dup panel -->
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <!-- ── LEFT: form column ── -->
      <div class="max-w-2xl">
        <!-- Resume dropzone -->
        <div class="mb-6">
          <input
            ref="resumeInputRef"
            type="file"
            accept=".pdf,.doc,.docx"
            class="hidden"
            @change="onResumeInputChange"
          />
          <div
            v-if="resumeFile"
            class="flex items-center gap-3 rounded-lg border border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-950/30 px-4 py-3"
          >
            <FileText class="size-5 text-brand-500 shrink-0" />
            <span class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate flex-1">
              {{ resumeFile.name }}
            </span>
            <Loader2 v-if="isParsing" class="size-4 text-brand-500 animate-spin shrink-0" />
            <span v-if="isParsing" class="text-xs text-brand-600 dark:text-brand-400 shrink-0">
              {{ t('candidate.new.parsing') }}
            </span>
            <button
              v-if="!isParsing"
              class="rounded p-0.5 text-surface-400 hover:text-danger-600 transition-colors shrink-0"
              :title="t('dashboard.common.delete')"
              @click="removeResume"
            >
              <X class="size-4" />
            </button>
          </div>
          <div
            v-else
            class="relative rounded-lg border-2 border-dashed transition-colors cursor-pointer"
            :class="dropzoneActive
              ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
              : 'border-surface-300 dark:border-surface-600 hover:border-brand-400 dark:hover:border-brand-600 bg-white dark:bg-surface-900'"
            @click="triggerResumeSelect"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <div class="flex flex-col items-center gap-2 py-8 px-4 text-center pointer-events-none">
              <Upload class="size-8 text-surface-400 dark:text-surface-500" />
              <p class="text-sm font-medium text-surface-700 dark:text-surface-300">
                {{ t('candidate.new.resumeDropzone') }}
              </p>
              <p class="text-xs text-surface-400 dark:text-surface-500">
                {{ t('candidate.new.resumeDropzoneHint') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Server error -->
        <div
          v-if="submitError"
          class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4 flex items-start gap-2"
        >
          <AlertTriangle class="size-4 shrink-0 mt-0.5" />
          <span>{{ submitError }}</span>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <!-- First Name -->
          <div>
            <label for="firstName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.candidates.fields.first_name') }} <span class="text-danger-500">*</span>
            </label>
            <input
              id="firstName"
              v-model="form.firstName"
              type="text"
              placeholder="e.g. Jane"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="errors.firstName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="errors.firstName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.firstName }}</p>
          </div>

          <!-- Last Name -->
          <div>
            <label for="lastName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.candidates.fields.last_name') }} <span class="text-danger-500">*</span>
            </label>
            <input
              id="lastName"
              v-model="form.lastName"
              type="text"
              placeholder="e.g. Doe"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="errors.lastName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="errors.lastName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.lastName }}</p>
          </div>

          <!-- Display Name (optional) -->
          <div>
            <label for="displayName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.candidates.fields.display_name') }}
              <span class="ml-1 text-xs font-normal text-surface-400">(optional — overrides default name format)</span>
            </label>
            <input
              id="displayName"
              v-model="form.displayName"
              type="text"
              placeholder="e.g. Nguyễn Văn A"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
            <p v-if="errors.displayName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.displayName }}</p>
          </div>

          <!-- Email -->
          <div>
            <label for="email" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.candidates.fields.email') }} <span class="text-danger-500">*</span>
            </label>
            <input
              id="email"
              v-model="form.email"
              type="email"
              placeholder="e.g. jane.doe@example.com"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="errors.email || dupResult?.exact.some(e => e.kind === 'email') ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="errors.email" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.email }}</p>
            <p v-else-if="dupResult?.exact.some(e => e.kind === 'email')" class="mt-1 text-xs text-danger-600 dark:text-danger-400">
              {{ t('candidate.new.dedup.exactEmail') }}
            </p>
          </div>

          <!-- Phone -->
          <div>
            <label for="phone" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.candidates.fields.phone') }}
            </label>
            <input
              id="phone"
              v-model="form.phone"
              type="tel"
              placeholder="e.g. +7 (999) 123-45-67"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="dupResult?.exact.some(e => e.kind === 'phone') ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="dupResult?.exact.some(e => e.kind === 'phone')" class="mt-1 text-xs text-danger-600 dark:text-danger-400">
              {{ t('candidate.new.dedup.exactPhone') }}
            </p>
          </div>

          <!-- Gender + DOB -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label for="gender" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.candidates.fields.gender') }}
              </label>
              <select
                id="gender"
                v-model="form.gender"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              >
                <option value="">{{ $t('dashboard.common.none') }}</option>
                <option value="male">{{ $t('dashboard.candidates.gender.male') }}</option>
                <option value="female">{{ $t('dashboard.candidates.gender.female') }}</option>
                <option value="other">{{ $t('dashboard.candidates.gender.other') }}</option>
                <option value="prefer_not_to_say">{{ $t('dashboard.candidates.gender.prefer_not_to_say') }}</option>
              </select>
            </div>
            <div>
              <label for="dateOfBirth" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.candidates.fields.dateOfBirth') }}
              </label>
              <input
                id="dateOfBirth"
                v-model="form.dateOfBirth"
                type="date"
                :max="new Date().toISOString().split('T')[0]"
                class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                :class="errors.dateOfBirth ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
              />
              <p v-if="errors.dateOfBirth" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.dateOfBirth }}</p>
            </div>
          </div>

          <!-- Sprint 3.3 (P2.2): Город -->
          <div>
            <label for="city" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ $t('dashboard.candidates.fields.city') }}
            </label>
            <input
              id="city"
              v-model="form.city"
              type="text"
              :placeholder="$t('dashboard.candidates.fields.cityPlaceholder')"
              autocomplete="address-level2"
              class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              :class="errors.city ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
            />
            <p v-if="errors.city" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.city }}</p>
          </div>

          <!-- Sprint 3.4 (P2.3): social-идентификаторы -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label for="linkedin" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.candidates.fields.linkedin') }}
              </label>
              <input
                id="linkedin"
                v-model="form.linkedin"
                type="text"
                placeholder="linkedin.com/in/..."
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              />
            </div>
            <div>
              <label for="telegram" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.candidates.fields.telegram') }}
              </label>
              <input
                id="telegram"
                v-model="form.telegram"
                type="text"
                placeholder="@username или t.me/username"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              />
            </div>
            <div>
              <label for="github" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ $t('dashboard.candidates.fields.github') }}
              </label>
              <input
                id="github"
                v-model="form.github"
                type="text"
                placeholder="github.com/username"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              />
            </div>
          </div>

          <!-- Source -->
          <div>
            <label for="source" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              {{ t('candidate.new.source') }}
              <span
                class="ml-1 text-xs font-normal text-surface-400 cursor-help"
                :title="t('candidate.new.sourceHint')"
              >
                ({{ t('candidate.new.sourceHint') }})
              </span>
            </label>
            <select
              id="source"
              v-model="selectedSource"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option
                v-for="opt in sourceOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3 pt-2">
            <button
              type="submit"
              :disabled="isSubmitDisabled"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Loader2 v-if="isSubmitting || isParsing" class="size-4 animate-spin" />
              {{ isSubmitting
                ? t('candidate.new.submitting')
                : isParsing
                  ? t('candidate.new.parsing')
                  : t('candidate.new.submit') }}
            </button>
            <NuxtLink
              :to="$localePath('/dashboard/candidates')"
              class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              {{ t('candidate.new.cancel') }}
            </NuxtLink>
          </div>
        </form>
      </div>

      <!-- ── RIGHT: duplicates panel ── -->
      <aside class="lg:sticky lg:top-4 lg:self-start">
        <div class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4">
          <div class="flex items-center gap-2 mb-3">
            <Users class="size-4 text-surface-500" />
            <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
              {{ t('candidate.new.dedup.panelTitle') }}
            </h2>
            <Loader2 v-if="checkLoading" class="ml-auto size-3.5 animate-spin text-surface-400" />
          </div>

          <!-- Empty state -->
          <p v-if="!hasAnyDup && !checkLoading" class="text-xs text-surface-400 dark:text-surface-500">
            {{ t('candidate.new.dedup.noneFound') }}
          </p>

          <!-- Exact dup block (hard block) -->
          <div v-if="hasExact" class="mb-3 rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/40 p-3">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-danger-700 dark:text-danger-300 mb-2">
              <AlertTriangle class="size-3.5" />
              {{ t('candidate.new.dedup.exactBlockTitle') }}
            </div>
            <ul class="space-y-2">
              <li v-for="(e, idx) in dupResult?.exact" :key="`e-${idx}`" class="text-xs">
                <div class="flex items-center gap-1.5">
                  <span class="text-surface-700 dark:text-surface-200 font-medium">{{ fullName(e) }}</span>
                  <span v-if="e.crossOrg" class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-warning-100 dark:bg-warning-950 text-warning-700 dark:text-warning-400" :title="t('candidate.new.dedup.crossOrgBadge')">
                    <Building2 class="size-3" />
                  </span>
                </div>
                <div class="text-surface-500 dark:text-surface-400 mt-0.5">
                  {{ e.kind === 'email' ? e.email : e.phone }}
                </div>
                <NuxtLink :to="candidateLink(e.candidateId)" class="mt-1 inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  <ExternalLink class="size-3" />
                  {{ t('candidate.new.dedup.openCard') }}
                </NuxtLink>
              </li>
            </ul>
          </div>

          <!-- Fuzzy list -->
          <div v-if="dupResult?.fuzzy.length" class="space-y-2">
            <div
              v-for="(f, idx) in dupResult.fuzzy"
              :key="`f-${idx}`"
              class="rounded-md border p-2.5"
              :class="f.score >= 95
                ? 'border-danger-200 dark:border-danger-800 bg-danger-50/50 dark:bg-danger-950/30'
                : 'border-warning-200 dark:border-warning-800 bg-warning-50/50 dark:bg-warning-950/30'"
            >
              <div class="flex items-center justify-between gap-2 mb-1">
                <span class="text-xs font-medium text-surface-700 dark:text-surface-200 truncate flex-1">{{ fullName(f) }}</span>
                <span
                  class="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
                  :class="f.score >= 95
                    ? 'bg-danger-100 dark:bg-danger-900/60 text-danger-700 dark:text-danger-300'
                    : 'bg-warning-100 dark:bg-warning-900/60 text-warning-700 dark:text-warning-300'"
                >
                  {{ f.score }}
                </span>
              </div>
              <div class="flex items-center gap-1 text-[11px] text-surface-500 dark:text-surface-400 mb-1">
                <span>{{ f.score >= 95 ? t('candidate.new.dedup.fuzzyHigh') : t('candidate.new.dedup.fuzzyMid') }}</span>
                <span v-if="f.crossOrg" class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-surface-100 dark:bg-surface-800 ml-1" :title="t('candidate.new.dedup.crossOrgBadge')">
                  <Building2 class="size-2.5" />
                </span>
              </div>
              <!-- Signals breakdown -->
              <div class="flex items-center gap-2 text-[10px] text-surface-500 dark:text-surface-400 mb-1.5">
                <span>{{ t('candidate.new.dedup.signalName') }}: <span class="font-mono">{{ f.signals.name }}</span></span>
                <span v-if="f.signals.city">{{ t('candidate.new.dedup.signalCity') }}: <span class="font-mono">{{ f.signals.city }}</span></span>
                <span v-if="f.signals.dob">{{ t('candidate.new.dedup.signalDob') }}: <span class="font-mono">{{ f.signals.dob }}</span></span>
              </div>
              <div v-if="f.email || f.phone" class="text-[11px] text-surface-500 dark:text-surface-400 truncate mb-1">
                {{ [f.email, f.phone].filter(Boolean).join(' · ') }}
              </div>
              <NuxtLink :to="candidateLink(f.candidateId)" class="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400">
                <ExternalLink class="size-3" />
                {{ t('candidate.new.dedup.openCard') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Exact dup modal — hard блок, предлагаем открыть существующего -->
    <Teleport to="body">
      <div
        v-if="showExactDupModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="showExactDupModal = false"
      >
        <div class="w-full max-w-lg rounded-lg bg-white dark:bg-surface-900 shadow-xl border border-surface-200 dark:border-surface-700 p-6">
          <div class="flex items-start gap-3 mb-4">
            <div class="rounded-full bg-danger-100 dark:bg-danger-900/40 p-2">
              <AlertTriangle class="size-5 text-danger-600 dark:text-danger-400" />
            </div>
            <div class="flex-1">
              <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">
                {{ t('candidate.new.dedup.exactModalTitle') }}
              </h3>
              <p class="text-sm text-surface-600 dark:text-surface-400">
                {{ t('candidate.new.dedup.exactModalBody') }}
              </p>
            </div>
          </div>
          <ul class="space-y-1.5 mb-5 max-h-48 overflow-auto">
            <li
              v-for="(e, idx) in dupResult?.exact ?? []"
              :key="`em-${idx}`"
              class="flex items-center justify-between gap-2 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{{ fullName(e) }}</div>
                <div class="text-xs text-surface-500 dark:text-surface-400 truncate">
                  {{ e.kind === 'email' ? (t('candidate.new.dedup.exactEmail') + ' — ' + (e.email || '')) : (t('candidate.new.dedup.exactPhone') + ' — ' + (e.phone || '')) }}
                </div>
                <div v-if="e.crossOrg" class="mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-warning-100 dark:bg-warning-950 text-warning-700 dark:text-warning-400 text-[10px]">
                  <Building2 class="size-3" />
                  {{ t('candidate.new.dedup.crossOrgBadge') }}
                </div>
              </div>
            </li>
          </ul>
          <div v-if="canEnrichExisting" class="mb-3 text-xs text-surface-500 dark:text-surface-400 italic">
            {{ t('candidate.new.dedup.enrichHint') }}
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
              :disabled="isEnriching"
              @click="showExactDupModal = false"
            >
              {{ t('candidate.new.dedup.editData') }}
            </button>
            <button
              v-if="canEnrichExisting"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isEnriching"
              @click="enrichExistingDup"
            >
              <svg v-if="isEnriching" class="animate-spin size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              {{ t('candidate.new.dedup.enrichExisting') }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              :disabled="isEnriching"
              @click="openExistingDup"
            >
              <ExternalLink class="size-4" />
              {{ t('candidate.new.dedup.openExisting') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Confirm modal for fuzzy ≥95 -->
    <Teleport to="body">
      <div
        v-if="showConfirmModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="showConfirmModal = false"
      >
        <div class="w-full max-w-lg rounded-lg bg-white dark:bg-surface-900 shadow-xl border border-surface-200 dark:border-surface-700 p-6">
          <div class="flex items-start gap-3 mb-4">
            <div class="rounded-full bg-warning-100 dark:bg-warning-900/40 p-2">
              <AlertTriangle class="size-5 text-warning-600 dark:text-warning-400" />
            </div>
            <div class="flex-1">
              <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">
                {{ t('candidate.new.dedup.confirmFuzzyTitle') }}
              </h3>
              <p class="text-sm text-surface-600 dark:text-surface-400">
                {{ t('candidate.new.dedup.confirmFuzzyBody') }}
              </p>
            </div>
          </div>
          <ul class="space-y-1.5 mb-5 max-h-48 overflow-auto">
            <li
              v-for="(f, idx) in (dupResult?.fuzzy ?? []).filter(x => x.score >= 95)"
              :key="`cf-${idx}`"
              class="flex items-center justify-between gap-2 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{{ fullName(f) }}</div>
                <div class="text-xs text-surface-500 dark:text-surface-400 truncate">
                  {{ [f.email, f.phone].filter(Boolean).join(' · ') || '—' }}
                </div>
              </div>
              <span class="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded bg-danger-100 dark:bg-danger-900/60 text-danger-700 dark:text-danger-300">
                {{ f.score }}
              </span>
            </li>
          </ul>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="showConfirmModal = false"
            >
              {{ t('candidate.new.dedup.confirmCancel') }}
            </button>
            <button
              type="button"
              class="rounded-lg bg-warning-600 hover:bg-warning-700 px-4 py-2 text-sm font-medium text-white transition-colors"
              @click="confirmAndCreate"
            >
              {{ t('candidate.new.dedup.confirmCreateAnyway') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
