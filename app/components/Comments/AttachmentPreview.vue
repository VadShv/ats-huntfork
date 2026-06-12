<script setup lang="ts">
/**
 * Attachment preview tile — image thumbnail or file chip.
 * Streams through /api/applications/.../attachments/:id endpoint (bucket stays private).
 */
import { computed } from 'vue'
import { Download, File, FileImage, FileSpreadsheet, FileText, X, Presentation } from 'lucide-vue-next'
import type { CommentAttachment } from '~/composables/useApplicationComments'

const props = defineProps<{
  applicationId: string
  commentId: string
  attachment: CommentAttachment
  canDelete: boolean
}>()

const emit = defineEmits<{
  remove: [attachmentId: string]
}>()

const { t } = useI18n()

const isImage = computed(() => props.attachment.mimeType.startsWith('image/'))
const baseUrl = computed(() =>
  `/api/applications/${props.applicationId}/comments/${props.commentId}/attachments/${props.attachment.id}`,
)
const inlineUrl = computed(() => `${baseUrl.value}?inline=1`)
const downloadUrl = computed(() => baseUrl.value)

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return FileSpreadsheet
  if (mime.includes('presentation') || mime.includes('powerpoint')) return Presentation
  if (mime.startsWith('text/') || mime === 'application/pdf' || mime.includes('word')) return FileText
  return File
}
</script>

<template>
  <div
    class="group inline-flex flex-col gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50/40 dark:bg-surface-800/40 overflow-hidden max-w-[200px] relative"
  >
    <!-- Image preview -->
    <a
      v-if="isImage"
      :href="inlineUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="block"
    >
      <img
        :src="inlineUrl"
        :alt="attachment.fileName"
        class="block w-full h-32 object-cover bg-surface-100 dark:bg-surface-900"
        loading="lazy"
      >
    </a>

    <!-- File chip -->
    <a
      v-else
      :href="downloadUrl"
      :download="attachment.fileName"
      class="flex items-start gap-2 px-2.5 py-2 no-underline hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
    >
      <component :is="iconFor(attachment.mimeType)" class="size-5 flex-shrink-0 mt-0.5 text-surface-500 dark:text-surface-400" />
      <div class="flex-1 min-w-0">
        <div class="truncate text-xs font-medium text-surface-800 dark:text-surface-200">
          {{ attachment.fileName }}
        </div>
        <div class="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">
          {{ fileSize(attachment.sizeBytes) }}
        </div>
      </div>
      <Download class="size-3.5 text-surface-400 dark:text-surface-500 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>

    <!-- Image filename + size below -->
    <div v-if="isImage" class="flex items-center justify-between gap-2 px-2 py-1 border-t border-surface-200/60 dark:border-surface-700/60">
      <div class="min-w-0">
        <div class="truncate text-[11px] font-medium text-surface-800 dark:text-surface-200" :title="attachment.fileName">
          {{ attachment.fileName }}
        </div>
        <div class="text-[10px] text-surface-500 dark:text-surface-400">
          {{ fileSize(attachment.sizeBytes) }}
        </div>
      </div>
      <a
        :href="downloadUrl"
        :download="attachment.fileName"
        :title="t('attachments.download')"
        class="flex-shrink-0 p-1 rounded text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
      >
        <Download class="size-3.5" />
      </a>
    </div>

    <!-- Delete button -->
    <button
      v-if="canDelete"
      type="button"
      class="absolute top-1 right-1 inline-flex items-center justify-center size-5 rounded-full bg-surface-900/70 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-0 hover:bg-red-600"
      :title="t('attachments.remove')"
      :aria-label="t('attachments.remove')"
      @click.prevent="emit('remove', attachment.id)"
    >
      <X class="size-3" />
    </button>
  </div>
</template>
