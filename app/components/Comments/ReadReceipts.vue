<script setup lang="ts">
/**
 * Read receipts — shows who has read the thread (avatars at bottom).
 */
import { ref, onMounted, computed } from 'vue'

const props = defineProps<{
  applicationId: string
}>()

const { t } = useI18n()

interface Reader {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  lastReadAt: string
}

const readers = ref<Reader[]>([])

onMounted(async () => {
  try {
    readers.value = await $fetch<Reader[]>(`/api/applications/${props.applicationId}/readers`)
  } catch {
    readers.value = []
  }
  // Mark as read
  try {
    await $fetch(`/api/applications/${props.applicationId}/read`, { method: 'POST' })
  } catch {}
})

const displayReaders = computed(() => readers.value.slice(0, 5))
const overflowCount = computed(() => Math.max(0, readers.value.length - 5))

const initial = (r: Reader) => (r.name ?? r.email ?? '?').slice(0, 1).toUpperCase()
</script>

<template>
  <div v-if="readers.length > 0" class="flex items-center gap-1 px-1 pt-1">
    <span class="text-[10px] text-surface-400">{{ t('comments.read_by') }}:</span>
    <div class="flex -space-x-1">
      <div
        v-for="r in displayReaders"
        :key="r.userId"
        class="grid size-5 place-items-center rounded-full ring-1 ring-white dark:ring-surface-900 bg-surface-200 dark:bg-surface-700 text-[8px] font-semibold text-surface-700 dark:text-surface-200"
        :title="r.name || r.email"
      >
        <img v-if="r.image" :src="r.image" :alt="r.name ?? ''" class="size-5 rounded-full object-cover">
        <span v-else>{{ initial(r) }}</span>
      </div>
    </div>
    <span v-if="overflowCount > 0" class="text-[10px] text-surface-400">+{{ overflowCount }}</span>
  </div>
</template>
