export default defineEventHandler(async (event) => {
  try {
    return await auth.handler(toWebRequest(event))
  } catch (error) {
    const requestUrl = getRequestURL(event)
    logError('auth.handler_error', {
      http_method: event.method,
      http_path: requestUrl.pathname,
      error_message: error instanceof Error ? error.message : 'Unknown error',
    })

    // Detect BETTER_AUTH_URL mismatch — the #1 self-hosting setup issue
    const requestOrigin = requestUrl.origin
    const configuredUrl = env.BETTER_AUTH_URL?.trim() || env.RAILWAY_PUBLIC_DOMAIN?.trim()
    const configuredOrigin = configuredUrl
      ? (() => { try { return new URL(configuredUrl.startsWith('http') ? configuredUrl : `https://${configuredUrl}`).origin } catch { return configuredUrl } })()
      : undefined
    const isUrlMismatch = configuredOrigin && requestOrigin !== configuredOrigin

    if (isUrlMismatch) {
      logError('auth.url_mismatch', {
        configured_origin: configuredOrigin,
        request_origin: requestOrigin,
      })
      throw createError({
        statusCode: 500,
        statusMessage: 'Ошибка конфигурации входа',
        data: {
          code: 'AUTH_URL_MISMATCH',
          message: `BETTER_AUTH_URL указывает на «${configuredOrigin}», но запрос пришёл с «${requestOrigin}». `
            + 'Обновите переменную окружения BETTER_AUTH_URL в соответствии с доменом развёртывания и выполните повторное развёртывание.',
        },
      })
    }

    const exposeDetails = isRailwayPreviewEnvironment(env.RAILWAY_ENVIRONMENT_NAME) || import.meta.dev
    const details = error instanceof Error ? error.message : 'Неизвестная ошибка'

    throw createError({
      statusCode: 500,
      statusMessage: 'Ошибка сервера',
      data: {
        code: 'AUTH_HANDLER_ERROR',
        message: exposeDetails
          ? details
          : 'Не удалось выполнить вход. При самостоятельном развёртывании проверьте, что переменная окружения BETTER_AUTH_URL соответствует домену развёртывания (например, «https://your-app.up.railway.app»), затем выполните повторное развёртывание.',
      },
    })
  }
})
