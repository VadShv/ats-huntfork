<script setup lang="ts">
import { Users, Plus, Trash2, X, Check, UserPlus, Send } from 'lucide-vue-next'

useSeoMeta({ title: 'Команды', description: 'Команды и лига рекрутеров, MVP-пуши' })

interface Member { userId: string; name: string }
interface Team { id: string; name: string; color: string; members: Member[] }
interface TeamsResponse { teams: Team[]; unassigned: Member[] }
interface Settings { mvpEnabled: boolean; mvpTelegramChatId: string | null; telegramBotConfigured: boolean; botUsername: string | null }

const { allowed: canManage } = usePermission({ organization: ['update'] })
const toast = useToast()

const { data, refresh } = useFetch<TeamsResponse>('/api/teams', { headers: useRequestHeaders(['cookie']) })
const { data: settings, refresh: refreshSettings } = useFetch<Settings>('/api/gamification/settings', { headers: useRequestHeaders(['cookie']) })

const teams = computed(() => data.value?.teams ?? [])
const unassigned = computed(() => data.value?.unassigned ?? [])

const showCreate = ref(false)
const newName = ref('')
const newColor = ref('#01696f')
async function createTeam() {
  if (!newName.value.trim()) return
  try {
    await $fetch('/api/teams', { method: 'POST', body: { name: newName.value.trim(), color: newColor.value } })
    newName.value = ''; showCreate.value = false
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Не удалось создать команду') }
}
async function deleteTeam(id: string) {
  try { await $fetch(`/api/teams/${id}`, { method: 'DELETE' }); await refresh() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
}
const assignFor = ref<string | null>(null)
async function addMember(teamId: string, userId: string) {
  try { await $fetch(`/api/teams/${teamId}/members`, { method: 'POST', body: { userId } }); assignFor.value = null; await refresh() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
}
async function removeMember(teamId: string, userId: string) {
  try { await $fetch(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' }); await refresh() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
}

const mvpEnabled = ref(false)
const mvpChatId = ref('')
watch(settings, (s) => { if (s) { mvpEnabled.value = s.mvpEnabled; mvpChatId.value = s.mvpTelegramChatId ?? '' } }, { immediate: true })
async function saveMvp() {
  try {
    await $fetch('/api/gamification/settings', { method: 'PATCH', body: { mvpEnabled: mvpEnabled.value, mvpTelegramChatId: mvpChatId.value || null } })
    toast.success('Настройки MVP сохранены'); await refreshSettings()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
}

const inputCls = 'rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500'
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50 flex items-center gap-2">
          <Users class="size-5 text-brand-500" /> Команды
        </h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">Команды рекрутеров для лиги. Лига считается по среднему RP на участника.</p>
      </div>
      <button v-if="canManage" type="button" class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3 py-2" @click="showCreate = !showCreate">
        <Plus class="size-4" /> Команда
      </button>
    </div>

    <section v-if="showCreate && canManage" class="mb-4 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-950/20 p-4 flex items-center gap-3">
      <input v-model="newName" type="text" placeholder="Название команды" :class="inputCls" class="flex-1" @keydown.enter="createTeam">
      <input v-model="newColor" type="color" class="size-9 rounded-lg border border-surface-300 dark:border-surface-700 bg-transparent cursor-pointer">
      <button type="button" class="inline-flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2" @click="createTeam"><Check class="size-4" />Создать</button>
    </section>

    <div class="space-y-3 mb-8">
      <div v-for="t in teams" :key="t.id" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
        <div class="flex items-center gap-2 mb-3">
          <span class="size-3.5 rounded-full" :style="{ backgroundColor: t.color }" />
          <span class="text-sm font-medium text-surface-900 dark:text-surface-100 flex-1">{{ t.name }}</span>
          <span class="text-xs text-surface-400">{{ t.members.length }} чел.</span>
          <button v-if="canManage" type="button" class="p-1.5 rounded-lg text-surface-400 hover:text-danger-600 hover:bg-surface-100 dark:hover:bg-surface-800" @click="deleteTeam(t.id)"><Trash2 class="size-4" /></button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="m in t.members" :key="m.userId" class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300">
            {{ m.name }}
            <button v-if="canManage" type="button" class="text-surface-400 hover:text-danger-500" @click="removeMember(t.id, m.userId)"><X class="size-3" /></button>
          </span>
          <div v-if="canManage" class="relative">
            <button type="button" class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-dashed border-surface-300 dark:border-surface-600 text-surface-500 hover:border-brand-400" @click="assignFor = assignFor === t.id ? null : t.id">
              <UserPlus class="size-3" /> добавить
            </button>
            <div v-if="assignFor === t.id && unassigned.length" class="absolute z-10 mt-1 w-48 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg p-1 max-h-48 overflow-y-auto">
              <button v-for="p in unassigned" :key="p.userId" type="button" class="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300" @click="addMember(t.id, p.userId)">{{ p.name }}</button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="!teams.length" class="text-sm text-surface-400 text-center py-6">Команд пока нет — создайте первую.</p>
    </div>

    <section v-if="canManage" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
      <div class="flex items-center gap-2 mb-3">
        <Send class="size-4 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">MVP-пуши в Telegram</span>
      </div>
      <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">Раз в неделю бот публикует лучшего рекрутера (по приросту RP) в указанный чат.</p>
      <div v-if="!settings?.telegramBotConfigured" class="text-xs text-amber-600 dark:text-amber-400 mb-3">
        Сначала подключите Telegram-бота в настройках коммуникаций.
      </div>
      <label class="flex items-center gap-2 mb-3">
        <input v-model="mvpEnabled" type="checkbox" class="size-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500">
        <span class="text-sm text-surface-700 dark:text-surface-300">Включить MVP-пуши</span>
      </label>
      <div class="flex items-center gap-2">
        <input v-model="mvpChatId" type="text" placeholder="chat_id канала (например -1001234567890)" :class="inputCls" class="flex-1">
        <button type="button" class="inline-flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2" @click="saveMvp"><Check class="size-4" />Сохранить</button>
      </div>
    </section>
  </div>
</template>
