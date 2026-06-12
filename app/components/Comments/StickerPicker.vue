<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface Sticker {
  id: string
  name: string
  url: string
  tags: string[]
}

const emit = defineEmits<{
  pick: [sticker: Sticker]
  close: []
}>()

const stickers = ref<Sticker[]>([])
const loading = ref(true)
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return stickers.value
  return stickers.value.filter(s =>
    s.name.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q)),
  )
})

onMounted(async () => {
  try {
    const res = await $fetch<{ stickers: Sticker[] }>('/stickers/manifest.json')
    stickers.value = res.stickers ?? []
  } catch {
    stickers.value = []
  } finally {
    loading.value = false
  }
})

function pick(s: Sticker) {
  emit('pick', s)
}
</script>

<template>
  <div
    class="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg z-30"
    @click.stop
  >
    <div class="border-b border-surface-100 dark:border-surface-800 p-2">
      <input
        v-model="search"
        type="text"
        :placeholder="$t('stickers.search_placeholder')"
        class="w-full rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      >
    </div>
    <div class="max-h-64 overflow-y-auto p-2">
      <div v-if="loading" class="py-4 text-center text-xs text-surface-400">
        {{ $t('stickers.loading') }}
      </div>
      <div v-else-if="filtered.length === 0" class="py-4 text-center text-xs text-surface-400 italic">
        {{ $t('stickers.empty') }}
      </div>
      <div v-else class="grid grid-cols-3 gap-2">
        <button
          v-for="s in filtered"
          :key="s.id"
          type="button"
          :title="s.name"
          class="aspect-square rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-1 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 cursor-pointer transition-colors"
          @click="pick(s)"
        >
          <img
            :src="s.url"
            :alt="s.name"
            class="h-full w-full object-contain"
            loading="lazy"
          >
        </button>
      </div>
    </div>
  </div>
</template>
