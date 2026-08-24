/**
 * createCloudRuFetch — обёртка fetch для Cloud.ru Foundation Models.
 *
 * Reasoning-модели (GLM, Qwen3.5/3.6) перед видимым ответом генерируют
 * скрытый блок «размышлений» — из-за него первый токен приходит через
 * десятки секунд. Когда пользователь панели выключает «Глубокий анализ»,
 * мы инжектим в тело Chat Completions параметр, отключающий thinking-фазу.
 *
 * Параметры отличаются по семействам (allowlist — незнакомые модели не трогаем):
 *   GLM  (zai-org/GLM-*)      → chat_template_kwargs: { enable_thinking: false }
 *   Qwen (Qwen/Qwen3.5|3.6-*) → chat_template_kwargs: { enable_thinking: false }
 *
 * Безопасность: если после инжекта эндпоинт ответил 4xx (параметр не принят),
 * запрос повторяется один раз с исходным телом — деградация в поведение
 * «как раньше», а не ошибка пользователю.
 *
 * Скрининговый контур это не затрагивает: обёртка подключается только
 * в streamTextOutput (саммари/чат панели Sidekick).
 */

export type ThinkingFamily = 'glm' | 'qwen'

/** Определяет семейство reasoning-модели Cloud.ru по её идентификатору. */
export function thinkingFamilyFor(model: string): ThinkingFamily | null {
  if (/^zai-org\/GLM/i.test(model)) return 'glm'
  if (/^Qwen\/Qwen3\.[56]/i.test(model)) return 'qwen'
  return null
}

/** Инжектит параметры отключения thinking в JSON-тело запроса. */
function injectDisable(bodyRaw: string, family: ThinkingFamily): string | null {
  try {
    const body = JSON.parse(bodyRaw)
    // vLLM-совместимые эндпоинты: enable_thinking в chat_template_kwargs
    // поддерживается и шаблоном GLM, и шаблоном Qwen3.
    body.chat_template_kwargs = { ...(body.chat_template_kwargs ?? {}), enable_thinking: false }
    if (family === 'glm') {
      // Родной параметр Z.ai API — на случай, если Cloud.ru проксирует его.
      body.thinking = { type: 'disabled' }
    }
    return JSON.stringify(body)
  }
  catch {
    return null
  }
}

export function createCloudRuFetch(disable: ThinkingFamily | null): typeof globalThis.fetch {
  if (!disable) return globalThis.fetch
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      const patched = injectDisable(init.body, disable)
      if (patched) {
        const resp = await globalThis.fetch(input, { ...init, body: patched })
        // Параметр не принят эндпоинтом — повторяем без него (как раньше).
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 401 && resp.status !== 403 && resp.status !== 429) {
          return globalThis.fetch(input, init)
        }
        return resp
      }
    }
    return globalThis.fetch(input, init)
  }
}
