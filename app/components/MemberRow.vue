<script setup lang="ts">
/**
 * ─────────────────────────────────────────────
 * MemberRow — строка участника организации
 * ─────────────────────────────────────────────
 * Используется на странице «Участники» в двух списках:
 * команда рекрутинга (owner/admin/member) и нанимающие менеджеры.
 * Дропдаун и модалки управляются родителем через события.
 */
import type { Component } from 'vue'
import {
  Crown, ShieldCheck, Shield, UserCheck,
  MoreHorizontal, Trash2, Loader2,
} from 'lucide-vue-next'

interface MemberItem {
  id: string
  userId: string
  role: string
  user: { name: string, email: string, image?: string }
  createdAt: Date
}

const props = defineProps<{
  member: MemberItem
  /** это текущий пользователь */
  isSelf: boolean
  /** можно управлять участниками (owner/admin) */
  canManage: boolean
  /** дропдаун действий открыт */
  dropdownOpen: boolean
  /** идёт смена роли этого участника */
  updatingRole: boolean
}>()

const emit = defineEmits<{
  toggleDropdown: []
  updateRole: [role: 'admin' | 'member']
  remove: []
}>()

const roleConfig: Record<string, { label: string, color: string, bg: string, icon: Component }> = {
  owner: { label: 'Владелец', color: 'text-warning-700 dark:text-warning-400', bg: 'bg-warning-50 dark:bg-warning-950', icon: Crown },
  admin: { label: 'Администратор', color: 'text-brand-700 dark:text-brand-400', bg: 'bg-brand-50 dark:bg-brand-950', icon: ShieldCheck },
  member: { label: 'Рекрутер', color: 'text-surface-700 dark:text-surface-300', bg: 'bg-surface-100 dark:bg-surface-800', icon: Shield },
  hiring_manager: { label: 'Нанимающий менеджер', color: 'text-info-700 dark:text-info-400', bg: 'bg-info-50 dark:bg-info-950', icon: UserCheck },
}

const cfg = computed(() => roleConfig[props.member.role] ?? roleConfig.member!)
const isHm = computed(() => props.member.role === 'hiring_manager')

function getInitials(name: string | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}
</script>

<template>
  <div class="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
    <!-- Avatar + Info row -->
    <div class="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
      <div class="flex-shrink-0">
        <img
          v-if="member.user.image"
          :src="member.user.image"
          :alt="member.user.name"
          class="size-10 rounded-full object-cover ring-2 ring-surface-100 dark:ring-surface-800"
        />
        <div v-else class="size-10 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-sm font-semibold text-brand-700 dark:text-brand-300 ring-2 ring-surface-100 dark:ring-surface-800">
          {{ getInitials(member.user.name) }}
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
            {{ member.user.name }}
          </span>
          <span v-if="isSelf" class="text-xs text-surface-400 dark:text-surface-500">(вы)</span>
        </div>
        <div class="text-sm text-surface-500 dark:text-surface-400 truncate">
          <a
            :href="`mailto:${member.user.email}`"
            target="_blank"
            class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
          >{{ member.user.email }}</a>
        </div>
      </div>
    </div>

    <!-- Role badge + Actions -->
    <div class="flex items-center gap-2 pl-[3.25rem] sm:pl-0 flex-shrink-0">
      <span
        :class="[cfg.bg, cfg.color]"
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      >
        <component :is="cfg.icon" class="size-3" />
        {{ cfg.label }}
      </span>

      <!-- Actions dropdown -->
      <div v-if="canManage && !isSelf && member.role !== 'owner'" class="relative" data-member-actions>
        <button
          class="p-1.5 rounded-md text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          @click.stop="emit('toggleDropdown')"
        >
          <MoreHorizontal class="size-4" />
        </button>

        <Transition
          enter-active-class="transition-all duration-150"
          leave-active-class="transition-all duration-100"
          enter-from-class="opacity-0 scale-95"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="dropdownOpen"
            class="absolute right-0 top-full mt-1 w-48 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg z-50 overflow-hidden"
          >
            <!-- Role options (не показываем для НМ — его роль меняется только пересозданием) -->
            <div v-if="!isHm" class="py-1 border-b border-surface-100 dark:border-surface-800">
              <div class="px-3 py-1.5 text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Изменить роль
              </div>
              <button
                v-if="member.role !== 'admin'"
                :disabled="updatingRole"
                class="w-full px-3 py-2 text-left text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex items-center gap-2 disabled:opacity-50 bg-transparent border-0 cursor-pointer"
                @click="emit('updateRole', 'admin')"
              >
                <ShieldCheck class="size-3.5 text-brand-500" />
                Сделать администратором
              </button>
              <button
                v-if="member.role !== 'member'"
                :disabled="updatingRole"
                class="w-full px-3 py-2 text-left text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex items-center gap-2 disabled:opacity-50 bg-transparent border-0 cursor-pointer"
                @click="emit('updateRole', 'member')"
              >
                <Shield class="size-3.5 text-surface-400" />
                Сделать рекрутером
              </button>
            </div>

            <!-- Remove -->
            <div class="py-1">
              <button
                class="w-full px-3 py-2 text-left text-sm text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors flex items-center gap-2 bg-transparent border-0 cursor-pointer"
                @click="emit('remove')"
              >
                <Trash2 class="size-3.5" />
                Удалить участника
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Loading indicator for role update -->
      <div v-if="updatingRole" class="flex-shrink-0">
        <Loader2 class="size-4 animate-spin text-brand-500" />
      </div>
    </div>
  </div>
</template>
