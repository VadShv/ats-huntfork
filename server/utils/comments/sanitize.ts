/**
 * Minimal markdown→HTML renderer for collaboration thread comments.
 *
 * The system does NOT ship a markdown library (marked / markdown-it), so we
 * implement a safe, deterministic subset:
 *   - HTML-escape all characters
 *   - Convert URLs to <a target="_blank" rel="noopener noreferrer nofollow">
 *   - Convert `code spans` → <code>code spans</code>
 *   - Convert *bold*  → <strong>
 *   - Convert _italic_ → <em>
 *   - Convert @"Имя Фамилия" / @username → <span class="mention">@…</span>
 *   - Preserve newlines as <br>
 *
 * This is intentionally conservative: no HTML tags are accepted from the user.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const URL_RE = /\b(https?:\/\/[^\s<]+)/g
// Mentions (после escapeHtml): @&quot;Имя Фамилия&quot;  /  @username
const QUOTED_MENTION_RE = /@&quot;([^&]+?)&quot;/g
const BARE_MENTION_RE = /@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu
const CODE_RE = /`([^`\n]+)`/g
const BOLD_RE = /\*([^*\n]+)\*/g
const ITALIC_RE = /(^|[\s(])_([^_\n]+)_(?=[\s.,!?;:)\]]|$)/g
// Stickers (после escapeHtml скобки не меняются): :sticker[fox_thumbs_up]:
const STICKER_RE = /:sticker\[([a-z0-9_]{1,40})\]:/g

export function renderMarkdown(body: string): string {
  if (!body) return ''
  let html = escapeHtml(body)

  // Code spans first — protect their contents from further substitution.
  const codeStash: string[] = []
  html = html.replace(CODE_RE, (_, code) => {
    codeStash.push(`<code>${code}</code>`)
    return `\u0000CODE${codeStash.length - 1}\u0000`
  })

  // Stickers — stash too so URL/inline-formatting passes don't touch them.
  const stickerStash: string[] = []
  html = html.replace(STICKER_RE, (_, id) => {
    stickerStash.push(
      `<img class="sticker" src="/stickers/${id}.webp" alt="sticker:${id}" loading="lazy" decoding="async" />`,
    )
    return `\u0000S${stickerStash.length - 1}\u0000`
  })

  // Mentions — process BEFORE inline formatting so bare-mention regex doesn't
  // accidentally re-match the contents of a quoted mention span.
  // Stash mentions as placeholders too, then restore.
  const mentionStash: string[] = []
  function stashMention(name: string): string {
    mentionStash.push(`<span class="mention" data-mention="${name}">@${name}</span>`)
    return `\u0000M${mentionStash.length - 1}\u0000`
  }
  html = html.replace(QUOTED_MENTION_RE, (_, name) => stashMention(name))
  html = html.replace(BARE_MENTION_RE, (_, token) => stashMention(token))

  // URLs (after mentions so we don't accidentally swallow @… inside)
  html = html.replace(URL_RE, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`
  })

  // Bold and italic
  html = html.replace(BOLD_RE, '<strong>$1</strong>')
  html = html.replace(ITALIC_RE, '$1<em>$2</em>')

  // Newlines → <br>
  html = html.replace(/\r\n|\n/g, '<br>')

  // Restore stashes
  html = html.replace(/\u0000M(\d+)\u0000/g, (_, i) => mentionStash[Number(i)] ?? '')
  html = html.replace(/\u0000S(\d+)\u0000/g, (_, i) => stickerStash[Number(i)] ?? '')
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeStash[Number(i)] ?? '')

  return html
}
