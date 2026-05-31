<script setup lang="ts">
import { ArrowLeft, Upload, FileText, Loader2, X } from 'lucide-vue-next'
import { z } from 'zod'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Add Candidate — Reqcore',
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
})

// Source field — UI only, not persisted to DB yet
// TODO: wire up when the DB schema gets a `source` column
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

    // Only fill fields that are still empty (don't overwrite recruiter input)
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
    // Keep the file attached — recruiter can still submit with manual data
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
  // Reset so same file can be re-selected
  input.value = ''
}

function removeResume() {
  resumeFile.value = null
  if (resumeInputRef.value) resumeInputRef.value.value = ''
}

// ─── Drag and drop ───────────────────────────

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
})

function validate(): boolean {
  const result = formSchema.safeParse({
    ...form.value,
    gender: form.value.gender || undefined,
    dateOfBirth: form.value.dateOfBirth || undefined,
    displayName: form.value.displayName || undefined,
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

async function handleSubmit() {
  submitError.value = null
  if (!validate()) return

  isSubmitting.value = true
  try {
    // 1. Create the candidate
    const newCandidate = await createCandidate({
      firstName: form.value.firstName,
      lastName: form.value.lastName,
      displayName: form.value.displayName || undefined,
      email: form.value.email,
      phone: form.value.phone || undefined,
      gender: (form.value.gender as 'male' | 'female' | 'other' | 'prefer_not_to_say') || undefined,
      dateOfBirth: form.value.dateOfBirth || undefined,
    })

    track('candidate_added')

    // 2. If there's a resume file, upload it
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
        // Do NOT roll back candidate creation — just warn
        toast.error(t('candidate.new.candidateCreatedResumeFailed'))
      }
    }

    // 3. Redirect to candidate profile
    const targetId = newCandidate?.id
    if (targetId) {
      await navigateTo(localePath(`/dashboard/candidates/${targetId}`))
    } else {
      await navigateTo(localePath('/dashboard/candidates'))
    }
  } catch (err: any) {
    const message = err.data?.statusMessage ?? 'Something went wrong'
    if (err.statusCode === 409 || err.data?.statusCode === 409) {
      errors.value.email = message
    } else {
      submitError.value = message
    }
  } finally {
    isSubmitting.value = false
  }
}

// Submit is disabled while parsing
const isSubmitDisabled = computed(() => isSubmitting.value || isParsing.value)
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      {{ $t('dashboard.candidates.addForm.back') }}
    </NuxtLink>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">{{ $t('dashboard.candidates.addForm.title') }}</h1>

    <!-- ── Resume dropzone ── -->
    <div class="mb-6">
      <!-- Hidden file input -->
      <input
        ref="resumeInputRef"
        type="file"
        accept=".pdf,.doc,.docx"
        class="hidden"
        @change="onResumeInputChange"
      />

      <!-- File already selected -->
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

      <!-- Dropzone (no file selected) -->
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
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4"
    >
      {{ submitError }}
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
          :class="errors.email ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.email" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.email }}</p>
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
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Gender + Date of Birth (side-by-side on wider screens) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <!-- Gender -->
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

        <!-- Date of Birth -->
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

      <!-- Source (UI only — not saved to DB yet) -->
      <div>
        <label for="source" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          {{ t('candidate.new.source') }}
          <!-- Tooltip: source not yet persisted -->
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
</template>
