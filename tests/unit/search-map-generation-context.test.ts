import { describe, it, expect } from 'vitest'
import {
  buildBriefContext, briefList, prepareDescription, stripHtml, segmentSemanticKey,
  formatExistingSegments, BRIEF_EMPTY_FALLBACK, DESCRIPTION_LIMIT,
} from '../../server/utils/searchMap/generationContext'
import { buildGeneratePrompt } from '../../server/utils/searchMap/buildGeneratePrompt'

const fullBrief = {
  hardMustHave: ['Консолидация по МСФО', { text: 'Опыт в Big 4 от 3 лет' }, '  '],
  niceToHave: [{ value: 'ACCA / DipIFR' }],
  dealBreakers: ['Только 1С без МСФО'],
  redFlagsToWatch: ['Частая смена работы'],
  responsibilities: 'Подготовка консолидированной отчётности группы.',
  teamContext: 'Команда 6 человек, подчинение финдиректору.',
  interviewProcess: 'HR → финдир → кейс',
  compensationNotes: 'Вилка 280–350 gross',
  idealProfile: 'Ex-Big 4 менеджер, ушёл в индустрию 2–3 года назад.',
  sourcingHints: 'Смотреть выпускников Kept и Б1, Telegram-чаты ACCA.',
  freeform: 'HM готов рассматривать без 1С.',
}

describe('briefList', () => {
  it('принимает массив строк и объектов, убирает пустые и дубли', () => {
    expect(briefList(['A', { text: 'B' }, { value: 'C' }, { label: 'D' }, '', ' a '])).toEqual(['A', 'B', 'C', 'D'])
  })
  it('строка с переносами — тоже список', () => {
    expect(briefList('x\ny; z')).toEqual(['x', 'y', 'z'])
  })
  it('null → пусто', () => {
    expect(briefList(null)).toEqual([])
    expect(briefList(undefined)).toEqual([])
  })
})

describe('buildBriefContext', () => {
  it('пустой бриф → fallback-строка', () => {
    expect(buildBriefContext(null, 'segments').text).toBe(BRIEF_EMPTY_FALLBACK)
    expect(buildBriefContext({}, 'segments').text).toBe(BRIEF_EMPTY_FALLBACK)
    expect(buildBriefContext({}, 'segments').filledFields).toBe(0)
  })

  it('для гипотез: must-have, deal-breakers, идеальный профиль есть; sourcingHints отдельно', () => {
    const ctx = buildBriefContext(fullBrief, 'segments')
    expect(ctx.text).toContain('Must have (обязательно)')
    expect(ctx.text).toContain('Консолидация по МСФО')
    expect(ctx.text).toContain('Опыт в Big 4 от 3 лет')
    expect(ctx.text).toContain('deal-breakers')
    expect(ctx.text).toContain('Идеальный профиль')
    expect(ctx.text).not.toContain('Telegram-чаты ACCA') // подсказки — отдельным блоком
    expect(ctx.sourcingHints).toContain('Telegram-чаты ACCA')
    expect(ctx.text).not.toContain('HR → финдир') // процесс интервью не передаём
    expect(ctx.filledFields).toBe(10)
  })

  it('для секций: обязанности и красные флаги есть, компенсации нет', () => {
    const ctx = buildBriefContext(fullBrief, 'sections')
    expect(ctx.text).toContain('Обязанности')
    expect(ctx.text).toContain('Красные флаги')
    expect(ctx.text).not.toContain('Компенсация')
    expect(ctx.sourcingHints).toBeNull()
  })

  it('для вердикта: компенсация и контекст команды присутствуют', () => {
    const ctx = buildBriefContext(fullBrief, 'summary')
    expect(ctx.text).toContain('Компенсация')
    expect(ctx.text).toContain('Команда и контекст')
  })

  it('длинные тексты обрезаются с многоточием', () => {
    const ctx = buildBriefContext({ responsibilities: 'x'.repeat(5000) }, 'sections')
    expect(ctx.text.length).toBeLessThan(1700)
    expect(ctx.text).toContain('…')
  })
})

describe('stripHtml / prepareDescription', () => {
  it('снимает теги, переводит <li> в маркеры, декодирует сущности', () => {
    const html = '<p>Мы ищем <strong>Менеджера МСФО</strong>.</p><ul><li>Консолидация</li><li>IFRS&nbsp;16 &amp; 15</li></ul>'
    const text = stripHtml(html)
    expect(text).toContain('Мы ищем Менеджера МСФО.')
    expect(text).toContain('• Консолидация')
    expect(text).toContain('IFRS 16 & 15')
    expect(text).not.toMatch(/<[^>]+>/)
  })

  it('короткое описание возвращается целиком', () => {
    expect(prepareDescription('Коротко')).toBe('Коротко')
    expect(prepareDescription('')).toBeNull()
    expect(prepareDescription(null)).toBeNull()
  })

  it('длинное описание: начало + конец с пометкой о пропуске', () => {
    const head = 'A'.repeat(5000)
    const tail = 'Z'.repeat(5000)
    const out = prepareDescription(head + tail)!
    expect(out.length).toBeLessThan(DESCRIPTION_LIMIT + 100)
    expect(out.startsWith('A'.repeat(100))).toBe(true)
    expect(out.endsWith('Z'.repeat(100))).toBe(true)
    expect(out).toMatch(/пропущено \d+ символов/)
  })
})

describe('segmentSemanticKey', () => {
  it('одинаковые слой+канал+тайтлы в другом порядке и регистре → один ключ', () => {
    const a = segmentSemanticKey({ name: 'Г1', donorLayer: 'core', channelCode: 'hh', titles: ['IFRS Manager', 'Менеджер МСФО'] })
    const b = segmentSemanticKey({ name: 'Совсем другое имя', donorLayer: 'core', channelCode: 'hh', titles: ['менеджер мсфо', 'ifrs manager'] })
    expect(a).toBe(b)
  })
  it('другой канал → другой ключ', () => {
    const a = segmentSemanticKey({ name: 'x', donorLayer: 'core', channelCode: 'hh', titles: ['A'] })
    const b = segmentSemanticKey({ name: 'x', donorLayer: 'core', channelCode: 'linkedin', titles: ['A'] })
    expect(a).not.toBe(b)
  })
  it('ё/е не различаются', () => {
    const a = segmentSemanticKey({ name: 'x', donorLayer: 'core', channelCode: 'hh', titles: ['Финконтролёр'] })
    const b = segmentSemanticKey({ name: 'x', donorLayer: 'core', channelCode: 'hh', titles: ['финконтролер'] })
    expect(a).toBe(b)
  })
})

describe('buildGeneratePrompt', () => {
  const base = {
    jobTitle: 'Менеджер МСФО',
    brief: fullBrief,
    criteria: [{ name: 'Консолидация', category: 'must', weight: 5 }],
    description: '<p>Описание <b>вакансии</b> с требованиями</p>',
    existingSections: [{ title: 'Ключевые слова', items: ['МСФО'] }],
    existingDonors: [{ name: 'Kept', layer: 'core' }],
    existingSegments: [{ name: 'Г1 · Alumni Big 4', donorLayer: 'alumni', channelCode: 'linkedin', titles: ['IFRS Manager'] }],
    channels: [{ code: 'hh', name: 'hh.ru' }, { code: 'telegram', name: 'Telegram' }],
  }

  it('часть «гипотезы» видит бриф, описание, подсказки, существующие гипотезы и каналы', () => {
    const { system, prompt } = buildGeneratePrompt({ part: 'segments', ...base, hint: 'через Telegram', limit: 3 })
    expect(prompt).toContain('Must have (обязательно)')
    expect(prompt).toContain('Описание вакансии')
    expect(prompt).toContain('Описание вакансии с требованиями')
    expect(prompt).not.toContain('<b>')
    expect(prompt).toContain('Подсказки по поиску')
    expect(prompt).toContain('Уже есть гипотезы')
    expect(prompt).toContain('Г1 · Alumni Big 4 · alumni · linkedin · IFRS Manager')
    expect(prompt).toContain('не более 3')
    expect(prompt).toContain('Уточнение рекрутёра')
    expect(prompt).toContain('через Telegram')
    expect(prompt).toContain('queryString не нужен')
    expect(system).toContain('"hh" (hh.ru)')
    expect(system).toContain('"telegram" (Telegram)')
  })

  it('часть «секции» не получает подсказки по поиску и список гипотез', () => {
    const { prompt } = buildGeneratePrompt({ part: 'sections', ...base })
    expect(prompt).not.toContain('Подсказки по поиску')
    expect(prompt).not.toContain('Уже есть гипотезы')
    expect(prompt).toContain('Уже заполнено в карте')
  })

  it('точечное дополнение одной секции: инструкция только про неё', () => {
    const { prompt } = buildGeneratePrompt({ part: 'sections', ...base, limit: 5, targetSection: { sectionType: 'exclusions', title: 'Исключения', guidance: 'Кого не ищем' } })
    expect(prompt).toContain('Дополни ТОЛЬКО секцию "exclusions"')
    expect(prompt).toContain('Кого не ищем')
    expect(prompt).toContain('не более 5')
    expect(prompt).not.toContain('3–5 секций')
  })

  it('доноры для конкретного слоя', () => {
    const { prompt } = buildGeneratePrompt({ part: 'donors', ...base, targetLayer: 'school' })
    expect(prompt).toContain('для слоя "school"')
  })

  it('часть «вердикт» получает текущий текст для переписывания', () => {
    const { prompt } = buildGeneratePrompt({ part: 'summary', ...base, currentSummary: 'Старый вердикт' })
    expect(prompt).toContain('Текущий вердикт')
    expect(prompt).toContain('Старый вердикт')
  })

  it('часть «запрос» описывает гипотезу и синтаксис канала, без описания вакансии', () => {
    const { prompt } = buildGeneratePrompt({
      part: 'query_string', ...base, hint: 'добавь английские синонимы',
      targetSegment: { name: 'Г2', titles: ['Менеджер МСФО'], keywords: ['консолидация'], geo: ['Москва'], channelCode: 'hh', channelName: 'hh.ru', queryLanguageHint: 'AND/OR/NOT', queryString: '"Менеджер МСФО"' },
    })
    expect(prompt).toContain('Перепиши строку запроса для гипотезы «Г2»')
    expect(prompt).toContain('Синтаксис канала: AND/OR/NOT')
    expect(prompt).toContain('Текущий запрос: "Менеджер МСФО"')
    expect(prompt).not.toContain('Описание вакансии (текст публикации)')
  })

  it('без брифа — fallback-строка, генерация не ломается', () => {
    const { prompt } = buildGeneratePrompt({ part: 'donors', jobTitle: 'X', brief: null })
    expect(prompt).toContain(BRIEF_EMPTY_FALLBACK)
  })
})

describe('formatExistingSegments', () => {
  it('пусто → null', () => {
    expect(formatExistingSegments([])).toBeNull()
  })
})
