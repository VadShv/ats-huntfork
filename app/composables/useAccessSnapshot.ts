import type { AccessSnapshot } from '~~/shared/access/capabilities'
import { emptyAccessSnapshot } from '~~/shared/access/capabilities'

/**
 * ─────────────────────────────────────────────
 * useAccessSnapshot — единый источник прав на клиенте (RBAC v2, Sprint 0.5)
 * ─────────────────────────────────────────────
 *
 * Грузит снапшот доступов ОДИН раз (SSR, с форвардингом cookie) в
 * useState('access-snapshot'), чтобы:
 *   • роль/права были доступны СИНХРОННО на первом рендере (нет мигания);
 *   • не плодить N async-запросов роли на страницу (был антипаттерн
 *     usePermission, docs/audit-rbac.md §6);
 *   • middleware и компоненты читали ОДИН и тот же снапшот.
 *
 * Источник — /api/auth/me/membership.access (Sprint 0.5 наполняет из member.role;
 * Спринт 2 переключит источник на can() без изменения формата снапшота).
 */
export function useAccessSnapshot() {
  const snapshot = useState<AccessSnapshot>('access-snapshot', () => emptyAccessSnapshot())

  // useFetch дедуплицирует по key в рамках запроса и переиспользует payload на
  // клиенте после гидрации. Cookie форвардится вручную для SSR-вызова.
  const { data, refresh, status } = useFetch('/api/auth/me/membership', {
    key: 'access-membership',
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    // Не бросать — отсутствие сессии/орг = пустой снапшот.
    default: () => null,
  })

  // Синхронизируем snapshot из ответа (работает и на SSR, и на клиенте).
  watch(
    data,
    (val) => {
      const access = (val as { access?: AccessSnapshot } | null)?.access
      snapshot.value = access ?? emptyAccessSnapshot()
    },
    { immediate: true },
  )

  const isLoading = computed(() => status.value === 'pending')

  /** Полный member-ответ (role/status/флаги) — для middleware. */
  const membership = data

  return { snapshot, membership, isLoading, refresh }
}
