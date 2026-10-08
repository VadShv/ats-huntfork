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
  <!-- Изображение: плитка 96×96 с превью; имя и размер — в подсказке, действия — по наведению -->
  <div
    v-if="isImage"
    class="group relative size-24 overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900"
    :title="`${attachment.fileName} · ${fileSize(attachment.sizeBytes)}`"
  >
    <a :href="inlineUrl" target="_blank" rel="noopener noreferrer" class="block size-full">
      <img
        :src="inlineUrl"
        :alt="attachment.fileName"
        class="block size-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
        loading="lazy"
        decoding="async"
      >
    </a>
    <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
      <span class="block truncate">{{ attachment.fileName }}</span>
    </div>
    <a
      :href="downloadUrl"
      :download="attachment.fileName"
      :title="t('attachments.download')"
      class="absolute bottom-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-surface-900/70 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-900 no-underline"
    >
      <Download class="size-3" />
    </a>
    <button
      v-if="canDelete"
      type="button"
      class="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full border-0 bg-surface-900/70 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600 cursor-pointer"
      :title="t('attachments.remove')"
      :aria-label="t('attachments.remove')"
      @click.prevent="emit('remove', attachment.id)"
    >
      <X class="size-3" />
    </button>
  </div>

  <!-- Документ: иконка типа + имя + размер -->
  <div
    v-else
    class="group relative inline-flex max-w-[220px] overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50/40 dark:bg-surface-800/40"
  >
    <a
      :href="downloadUrl"
      :download="attachment.fileName"
      class="flex items-start gap-2 px-2.5 py-2 no-underline transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
    >
      <component :is="iconFor(attachment.mimeType)" class="mt-0.5 size-5 flex-shrink-0 text-surface-500 dark:text-surface-400" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs font-medium text-surface-800 dark:text-surface-200" :title="attachment.fileName">
          {{ attachment.fileName }}
        </div>
        <div class="mt-0.5 text-[10px] text-surface-500 dark:text-surface-400">
          {{ fileSize(attachment.sizeBytes) }}
        </div>
      </div>
      <Download class="mt-0.5 size-3.5 text-surface-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-surface-500" />
    </a>
    <button
      v-if="canDelete"
      type="button"
      class="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full border-0 bg-surface-900/70 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600 cursor-pointer"
      :title="t('attachments.remove')"
      :aria-label="t('attachments.remove')"
      @click.prevent="emit('remove', attachment.id)"
    >
      <X class="size-3" />
    </button>
  </div>
</template>
