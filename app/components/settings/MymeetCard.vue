<script setup lang="ts">
import { Video, Check, Unplug, RefreshCw } from 'lucide-vue-next'

const { t } = useI18n()
const toast = useToast()
const { status, connect, disconnect, test } = useMymeet()
const { allowed: canManage } = usePermission({ organization: ['update'] })

const apiKey = ref('')
const busy = ref(false)

async function onConnect() {
  if (!apiKey.value.trim()) return
  busy.value = true
  try {
    const res: any = await connect(apiKey.value.trim())
    apiKey.value = ''
    toast.success(t('settings.mymeet.connected', { n: res?.toolCount ?? 0 }))
  }
  catch (err: any) {
    toast.error(t('settings.mymeet.connectError'), { message: err?.data?.statusMessage })
  }
  finally { busy.value = false }
}

async function onTest() {
  busy.value = true
  try {
    const res: any = await test()
    toast.success(t('settings.mymeet.tested', { n: res?.toolCount ?? 0 }))
  }
  catch (err: any) {
    toast.error(t('settings.mymeet.testError'), { message: err?.data?.statusMessage })
  }
  finally { busy.value = false }
}

async function onDisconnect() {
  busy.value = true
  try { await disconnect(); toast.success(t('settings.mymeet.disconnected')) }
  catch { toast.error(t('settings.mymeet.connectError')) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-3 flex items-center gap-2">
      <Video class="size-5 text-brand-600" />
      <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('settings.mymeet.title') }}</h3>
      <span
        v-if="status.connected"
        class="ml-auto inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-950/50 dark:text-success-400"
      ><Check class="size-3" /> {{ t('settings.mymeet.statusConnected') }}</span>
    </div>
    <p class="mb-3 text-xs text-surface-500 dark:text-surface-400">{{ t('settings.mymeet.subtitle') }}</p>

    <template v-if="!status.connected">
      <div v-if="canManage" class="flex gap-2">
        <input
          v-model="apiKey"
          type="password"
          :placeholder="t('settings.mymeet.keyPlaceholder')"
          class="flex-1 rounded-md border border-surface-200 bg-white px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-800"
        >
        <UiButton
          size="sm"
          :loading="busy"
          :disabled="!apiKey.trim()"
          @click="onConnect"
        >
          {{ t('settings.mymeet.connect') }}
        </UiButton>
      </div>
      <p v-else class="text-xs text-surface-400">{{ t('settings.mymeet.noPermission') }}</p>
    </template>

    <template v-else>
      <div v-if="status.tools.length" class="mb-3">
        <p class="mb-1 text-xs font-medium text-surface-500">{{ t('settings.mymeet.discovered') }}:</p>
        <div class="flex flex-wrap gap-1">
          <span v-for="tool in status.tools" :key="tool.name" class="rounded bg-surface-100 px-1.5 py-0.5 text-[11px] text-surface-600 dark:bg-surface-800 dark:text-surface-300">{{ tool.name }}</span>
        </div>
      </div>
      <div v-if="canManage" class="flex gap-2">
        <UiButton variant="secondary" size="sm" :icon-left="RefreshCw" :disabled="busy" @click="onTest">
          {{ t('settings.mymeet.test') }}
        </UiButton>
        <UiButton variant="outline" size="sm" :icon-left="Unplug" :disabled="busy" class="border-danger-200 text-danger-600 hover:bg-danger-50 dark:border-danger-900 dark:hover:bg-danger-950/40" @click="onDisconnect">
          {{ t('settings.mymeet.disconnect') }}
        </UiButton>
      </div>
    </template>
  </div>
</template>
