import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

/**
 * Composable for document operations (upload, download, delete, preview).
 * Used on the candidate detail page Documents tab.
 *
 * All mutations use `$fetch` (user-triggered) and refresh the candidate
 * data cache so the document list updates automatically.
 */
export function useDocuments() {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  /**
   * Upload a document for a candidate.
   * Sends multipart/form-data to POST /api/candidates/:id/documents.
   *
   * @param candidateId - The candidate to attach the document to
   * @param file - The file to upload
   * @param type - Document type: 'resume' | 'cover_letter' | 'other'
   * @returns The created document record
   */
  async function uploadDocument(
    candidateId: string,
    file: File,
    type: 'resume' | 'cover_letter' | 'other' = 'resume',
  ) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)
    const endpoint = `/api/candidates/${candidateId}/documents` as string

    let result: unknown
    try {
      result = await $fetch(endpoint, {
        method: 'POST',
        body: formData,
      })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }

    // Refresh the candidate detail cache so the document list updates
    await refreshNuxtData(`candidate-${candidateId}`)

    return result
  }

  /**
   * Download a document via the server-proxied download URL.
   * The server streams the file directly from S3 with auth verification —
   * no presigned URLs are ever exposed to the client.
   *
   * Ранее использовался `window.open`, который НЕ бросает при 403/404/500 —
   * поэтому try/catch у вызывающего кода был бесполезен, и пользователь не
   * получал toast при провале. Теперь тянем blob через $fetch: при HTTP-ошибке
   * $fetch выбрасывает, и вызывающий код может честно показать ошибку.
   *
   * @param documentId - The document to download
   * @param filename - Оригинальное имя файла (originalFilename). Blob-URL не
   *   несёт серверный Content-Disposition, поэтому имя нужно задать явно, иначе
   *   браузер сохранит файл со случайным именем без расширения.
   */
  async function downloadDocument(documentId: string, filename?: string) {
    let blob: Blob
    try {
      blob = await $fetch<Blob>(`/api/documents/${documentId}/download`, { responseType: 'blob' })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename ?? ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Освобождаем object URL после того, как браузер начал скачивание.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  /**
   * Get the URL for inline preview of a PDF document.
   * Returns the API endpoint URL directly — the server streams the PDF
   * bytes so the iframe loads from the same origin (no CORS issues).
   * Only works for PDFs; the server returns 415 for other types.
   *
   * @param documentId - The document to preview
   * @returns The preview endpoint URL to use as iframe src
   */
  function getPreviewUrl(documentId: string): string {
    return `/api/documents/${documentId}/preview`
  }

  /**
   * Delete a document and refresh the candidate data cache.
   *
   * @param documentId - The document to delete
   * @param candidateId - The owning candidate (used to refresh the cache)
   */
  async function deleteDocument(documentId: string, candidateId: string) {
    const endpoint = `/api/documents/${documentId}` as string
    try {
      await $fetch(endpoint, { method: 'DELETE' })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
    await refreshNuxtData(`candidate-${candidateId}`)
  }

  return {
    uploadDocument,
    downloadDocument,
    getPreviewUrl,
    deleteDocument,
  }
}
