<script setup lang="ts">
/**
 * Каналы поиска — список системных и custom-каналов.
 * docs/tz-search-map.md §11.1
 */
definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const toast = useToast()
const { allowed: canManage } = usePermission({ searchMap: ['manage_registry'] })

const { data, refresh } = await useFetch('/api/search-map/channels')

const priorityLabel: Record<string, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' }

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({
  code: '',
  name: '',
  defaultPriority: 'medium',
  urlTemplate: '',
  queryLanguageHint: '',
  targetSite: '',
})

async function createChannel() {
  if (!form.code.trim() || !form.name.trim()) return
  creating.value = true
  try {
    await $fetch('/api/search-map/channels', {
      method: 'POST',
      body: {
        code: form.code,
        name: form.name,
        defaultPriority: form.defaultPriority,
        urlTemplate: form.urlTemplate || null,
        queryLanguageHint: form.queryLanguageHint || null,
        targetSite: form.targetSite || null,
      },
    })
    toast.success('Канал создан')
    showCreate.value = false
    form.code = ''
    form.name = ''
    form.urlTemplate = ''
    form.queryLanguageHint = ''
    form.targetSite = ''
    await refresh()
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  } finally {
    creating.value = false
  }
}

async function toggleChannel(channel: any) {
  try {
    await $fetch(`/api/search-map/channels/${channel.id}`, {
      method: 'PATCH',
      body: { isActive: !channel.isActive },
    })
    await refresh()
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

const priorityOptions = [
  { label: 'Высокий', value: 'high' },
  { label: 'Средний', value: 'medium' },
  { label: 'Низкий', value: 'low' },
]
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-300">Каналы поиска</h2>
      <UiButton v-if="canManage" size="sm" @click="showCreate = !showCreate">Добавить канал</UiButton>
    </div>

    <!-- Create form -->
    <div v-if="showCreate && canManage" class="mb-4 space-y-2 rounded-lg border border-surface-200 p-4 dark:border-surface-800">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-sm font-medium">Код</label>
          <UiInput v-model="form.code" placeholder="custom_xray" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Название</label>
          <UiInput v-model="form.name" placeholder="Google x-ray StackOverflow" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-sm font-medium">Приоритет</label>
          <UiSelect v-model="form.defaultPriority" :options="priorityOptions" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">targetSite (для x-ray)</label>
          <UiInput v-model="form.targetSite" placeholder="stackoverflow.com" />
        </div>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">URL-шаблон</label>
        <UiInput v-model="form.urlTemplate" placeholder="https://www.google.com/search?q={query}" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">Подсказка по синтаксису</label>
        <UiInput v-model="form.queryLanguageHint" placeholder="Google x-ray: boolean AND/OR/NOT…" />
      </div>
      <UiButton size="sm" :loading="creating" @click="createChannel">Создать</UiButton>
    </div>

    <div class="space-y-2">
      <div
        v-for="channel in data?.items"
        :key="channel.id"
        class="flex items-center justify-between rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-800"
      >
        <div class="flex items-center gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-surface-900 dark:text-surface-50">{{ channel.name }}</span>
              <UiBadge v-if="channel.isSystem" tone="neutral">Системный</UiBadge>
              <UiBadge v-if="!channel.isActive" tone="danger">Неактивен</UiBadge>
            </div>
            <p class="mt-0.5 text-xs text-surface-500">{{ channel.code }}</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-surface-500">{{ priorityLabel[channel.defaultPriority] }}</span>
          <span v-if="channel.targetSite" class="text-xs text-brand-600">site:{{ channel.targetSite }}</span>
          <UiButton v-if="canManage && !channel.isSystem" size="xs" variant="ghost" @click="toggleChannel(channel)">
            {{ channel.isActive ? 'Выкл' : 'Вкл' }}
          </UiButton>
        </div>
      </div>
    </div>

    <div v-if="!data?.items?.length" class="mt-4 rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <p class="text-sm text-surface-500">Каналы загружаются…</p>
    </div>
  </div>
</template>
