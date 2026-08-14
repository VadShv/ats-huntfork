const PREVIEW_READ_ONLY_MESSAGE = 'Это демонстрационная версия только для просмотра. Редактирование здесь недоступно, но будет полностью доступно при самостоятельном развёртывании.'

export function createPreviewReadOnlyError() {
  return createError({
    statusCode: 403,
    statusMessage: PREVIEW_READ_ONLY_MESSAGE,
    data: {
      code: 'PREVIEW_READ_ONLY',
      message: PREVIEW_READ_ONLY_MESSAGE,
    },
  })
}
