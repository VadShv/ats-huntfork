import { describe, it, expect } from 'vitest'
import { renderMarkdown, escapeHtml } from '../../server/utils/comments/sanitize'

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  })
})

describe('renderMarkdown', () => {
  it('returns empty string on empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('escapes HTML tags', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('converts URLs to anchor tags with safe attributes', () => {
    const html = renderMarkdown('see https://huntfork.ru/docs for more')
    expect(html).toContain('<a href="https://huntfork.ru/docs"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('renders bare @mentions as spans', () => {
    const html = renderMarkdown('@ivan check this')
    expect(html).toContain('<span class="mention"')
    expect(html).toContain('data-mention="ivan"')
    expect(html).toContain('@ivan')
  })

  it('renders quoted @"Имя Фамилия" mentions', () => {
    const html = renderMarkdown('@"Иван Иванов" посмотри')
    expect(html).toContain('data-mention="Иван Иванов"')
    expect(html).toContain('@Иван Иванов')
  })

  it('renders newlines as <br>', () => {
    expect(renderMarkdown('first\nsecond')).toBe('first<br>second')
  })

  it('renders bold and italic', () => {
    expect(renderMarkdown('*bold*')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('hello _italic_ world')).toContain('<em>italic</em>')
  })

  it('renders code spans verbatim and does not transform their contents', () => {
    const html = renderMarkdown('use `*literal*` here')
    expect(html).toContain('<code>*literal*</code>')
    expect(html).not.toContain('<strong>literal</strong>')
  })

  it('never produces unescaped < or > outside of generated tags', () => {
    const html = renderMarkdown('text with <tag> inside')
    // any < or > should belong only to the rendered <br>, <a>, <code>, <span>, <strong>, <em>, <img class="sticker"> tags
    const stripped = html
      .replace(/<\/?(br|a|code|span|strong|em|img)([^>]*)>/g, '')
    expect(stripped).not.toMatch(/[<>]/)
  })

  describe('stickers', () => {
    it('renders :sticker[id]: as <img class="sticker">', () => {
      const html = renderMarkdown('Отличный кандидат! :sticker[fox_thumbs_up]:')
      expect(html).toContain('<img class="sticker"')
      expect(html).toContain('src="/stickers/fox_thumbs_up.webp"')
      expect(html).toContain('alt="sticker:fox_thumbs_up"')
    })

    it('rejects invalid sticker id (uppercase / special chars)', () => {
      expect(renderMarkdown(':sticker[Fox]:')).not.toContain('<img')
      expect(renderMarkdown(':sticker[../etc/passwd]:')).not.toContain('<img')
      expect(renderMarkdown(':sticker[a b]:')).not.toContain('<img')
    })

    it('handles multiple stickers in one comment', () => {
      const html = renderMarkdown(':sticker[a_one]: text :sticker[b_two]:')
      const matches = html.match(/<img class="sticker"/g) ?? []
      expect(matches.length).toBe(2)
    })

    it('does not render sticker inside code spans', () => {
      const html = renderMarkdown('`:sticker[fox_thumbs_up]:`')
      expect(html).toContain('<code>')
      expect(html).not.toContain('<img class="sticker"')
    })
  })
})
