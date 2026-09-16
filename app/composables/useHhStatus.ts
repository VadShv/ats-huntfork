/**
 * useHhStatus — кэшированный статус подключения hh.ru для текущей организации.
 *
 * Один singleton-запрос (`useFetch` с ключом `hh-status`) для всех ворот,
 * пунктов навигации и пустых состояний. Не дублирует запросы в `integrations.vue`
 * (там свой `useFetch` с тем же ключом — Nuxt 4 шарит ref по ключу).
 */
export interface HhStatusAccount {
  hhUserId?: string
  hhEmployerId?: string | null
  hhEmail?: string | null
  hhFirstName?: string | null
  hhLastName?: string | null
  webhookEnabled?: boolean
}

export interface HhStatusResponse {
  connected: boolean
  configured: boolean
  configSource?: 'db' | 'env' | 'none' | string
  redirectUri?: string
  account?: HhStatusAccount
}

export function useHhStatus() {
  const { data, status, refresh } = useFetch<HhStatusResponse>('/api/hh/status', {
    key: 'hh-status',
    default: () => ({ connected: false, configured: false }) as HhStatusResponse,
  })

  const connected = computed(() => Boolean(data.value?.connected))
  const configured = computed(() => Boolean(data.value?.configured))
  const configSource = computed(() => data.value?.configSource ?? 'none')
  const loading = computed(() => status.value === 'pending')

  return { data, status, refresh, connected, configured, configSource, loading }
}
