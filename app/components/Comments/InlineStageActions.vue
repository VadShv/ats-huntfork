<script setup lang="ts">
/**
 * Inline stage actions — move application through pipeline directly from discussion.
 * Compact dropdown "Move to…" + quick buttons (Advance / Reject).
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { ChevronDown, ArrowRight, X, Check } from 'lucide-vue-next'
import { useApplicationStages } from '~/composables/useApplicationStages'

const props = defineProps<{
  applicationId: string
  compact?: boolean
}>()

const emit = defineEmits<{
  moved: []
}>()

const { t } = useI18n()
const { stages, loading, moving, currentStage, nextStage, rejectStage, fetchStages, moveStage } = useApplicationStages(props.applicationId)

onMounted(fetchStages)

const dropdownOpen = ref(false)
const dropdownRoot = ref<HTMLElement | null>(null)
const selectedStageId = ref<string | null>(null)
const moveComment = ref('')

const visibleStages = computed(() => stages.value.filter(s => !s.isArchived && !s.isHidden && s.id !== currentStage.value?.id))

function handleDocClick(e: MouseEvent) {
  if (!dropdownOpen.value) return
  if (dropdownRoot.value && !dropdownRoot.value.contains(e.target as Node)) {
    dropdownOpen.value = false
    selectedStageId.value = null
    moveComment.value = ''
  }
}
onMounted(() => document.addEventListener('click', handleDocClick))
onBeforeUnmount(() => document.removeEventListener('click', handleDocClick))

async function doMove(stageId: string, comment?: string) {
  const ok = await moveStage(stageId, comment)
  if (ok) {
    emit('moved')
    dropdownOpen.value = false
    selectedStageId.value = null
    moveComment.value = ''
  }
}

async function quickAdvance() {
  if (nextStage.value) await doMove(nextStage.value.id)
}

async function quickReject() {
  if (rejectStage.value) await doMove(rejectStage.value.id)
}
</script>

<template>
  <div v-if="!loading && visibleStages.length > 0" class="flex items-center gap-1" ref="dropdownRoot">
    <!-- Quick: Advance -->
    <button
      v-if="nextStage"
      type="button"
      :disabled="moving"
      class="inline-flex items-center gap-1 rounded-md bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/60 px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/30 disabled:opacity-50 cursor-pointer transition-colors"
      @click="quickAdvance"
    >
      <ArrowRight class="size-3" />
      <span class="hidden sm:inline">{{ t('comments.advance') }}</span>
    </button>

    <!-- Quick: Reject -->
    <button
      v-if="rejectStage && currentStage?.bucket !== 'rejected'"
      type="button"
      :disabled="moving"
      class="inline-flex items-center gap-1 rounded-md bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800/60 px-2 py-1 text-[11px] font-medium text-danger-700 dark:text-danger-300 hover:bg-danger-100 dark:hover:bg-danger-900/30 disabled:opacity-50 cursor-pointer transition-colors"
      @click="quickReject"
    >
      <X class="size-3" />
      <span class="hidden sm:inline">{{ t('comments.reject') }}</span>
    </button>

    <!-- Full dropdown -->
    <div class="relative">
      <button
        type="button"
        :disabled="moving"
        class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50 cursor-pointer transition-colors"
        @click="dropdownOpen = !dropdownOpen"
      >
        {{ t('comments.move_stage') }}
        <ChevronDown class="size-3" :class="dropdownOpen ? 'rotate-180' : ''" />
      </button>

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="opacity-0 scale-95 -translate-y-1"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="dropdownOpen"
          class="absolute right-0 top-[calc(100%+4px)] z-30 w-56 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg overflow-hidden"
        >
          <!-- Stage list -->
          <ul v-if="!selectedStageId" class="py-1 max-h-60 overflow-y-auto scrollbar-thin">
            <li
              v-for="s in visibleStages"
              :key="s.id"
              class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-100 dark:hover:bg-surface-800"
              @click="selectedStageId = s.id"
            >
              <span
                class="size-2 flex-shrink-0 rounded-full"
                :style="{ backgroundColor: s.color ?? '#ccc' }"
              />
              <span class="flex-1 truncate" :class="s.isTerminal ? 'text-surface-400' : ''">
                {{ s.name || s.id }}
              </span>
              <span v-if="s.isTerminal" class="text-[10px] text-surface-400">terminal</span>
            </li>
          </ul>

          <!-- Comment + confirm -->
          <div v-else class="p-3">
            <p class="mb-2 text-xs text-surface-600 dark:text-surface-300">
              {{ t('comments.move_stage') }} →
              <span class="font-medium">{{ visibleStages.find(s => s.id === selectedStageId)?.name }}</span>
            </p>
            <textarea
              v-model="moveComment"
              rows="2"
              :placeholder="t('comments.composer_placeholder')"
              class="w-full rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1.5 text-xs text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none"
            />
            <div class="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-md px-2 py-1 text-xs text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
                @click="selectedStageId = null; moveComment = ''"
              >
                {{ t('comments.cancel') }}
              </button>
              <button
                type="button"
                :disabled="moving"
                class="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
                @click="doMove(selectedStageId!, moveComment.trim() || undefined)"
              >
                <Check class="size-3" />
                {{ t('comments.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
