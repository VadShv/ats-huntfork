<script setup lang="ts">
/**
 * Прочитавшие тред — компактная стопка аватаров под лентой («прочитали ··»).
 * Данные загружает родитель (ApplicationCommentThread): он же использует мою
 * отметку прочтения для разделителя «Новые сообщения», поэтому запрос один.
 */
import { computed } from 'vue'
import { authorHue } from '~/composables/useDiscussionColors'

interface Reader {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  lastReadAt: string
}

const props = defineProps<{
  readers: Reader[]
  /** Себя в списке не показываем — важно, кто ещё видел тред. */
  currentUserId?: string
}>()

const { t, locale } = useI18n()

const others = computed(() => props.readers.filter(r => r.userId !== props.currentUserId))
const displayReaders = computed(() => others.value.slice(0, 5))
const overflowCount = computed(() => Math.max(0, others.value.length - 5))

const initial = (r: Reader) => (r.name ?? r.email ?? '?').slice(0, 1).toUpperCase()
function title(r: Reader) {
  const when = new Date(r.lastReadAt).toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return `${r.name || r.email} · ${when}`
}
</script>

<template>
  <div v-if="others.length > 0" class="flex items-center gap-1.5 px-1 pt-1">
    <span class="text-[10px] text-surface-400">{{ t('comments.read_by') }}</span>
    <div class="flex -space-x-1">
      <div
        v-for="r in displayReaders"
        :key="r.userId"
        class="disc-avatar grid size-4 place-items-center rounded-full text-[7px] font-semibold"
        :style="{ '--h': authorHue(r.userId) }"
        :title="title(r)"
      >
        <img v-if="r.image" :src="r.image" :alt="r.name ?? ''" class="size-4 rounded-full object-cover">
        <span v-else>{{ initial(r) }}</span>
      </div>
    </div>
    <span v-if="overflowCount > 0" class="text-[10px] text-surface-400">+{{ overflowCount }}</span>
  </div>
</template>
