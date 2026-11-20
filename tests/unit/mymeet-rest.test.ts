import { describe, it, expect } from 'vitest'
import {
  describeFetchError,
  extractTranscriptFromReport,
  extractSummaryFromReport,
  extractDurationSecFromReport,
  extractParticipantsFromReport,
} from '../../server/utils/mymeet/rest'

describe('mymeet/rest · describeFetchError', () => {
  it('вытаскивает код причины из undici "fetch failed"', () => {
    const err = new Error('fetch failed') as Error & { cause?: unknown }
    err.cause = Object.assign(new Error('connect ECONNRESET 34.147.29.110:443'), { code: 'ECONNRESET' })
    const msg = describeFetchError(err, 'mcp.mymeet.ai')
    expect(msg).toContain('fetch failed')
    expect(msg).toContain('ECONNRESET')
    expect(msg).toContain('mcp.mymeet.ai')
  })

  it('таймаут распознаётся по имени ошибки', () => {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    expect(describeFetchError(err, 'backend.mymeet.ai')).toMatch(/таймаут.*backend\.mymeet\.ai/)
  })

  it('не падает на не-Error', () => {
    expect(describeFetchError('boom', 'h')).toBe('boom (h)')
  })
})

describe('mymeet/rest · extractTranscriptFromReport', () => {
  it('строка transcript на верхнем уровне', () => {
    const t = extractTranscriptFromReport({ transcript: 'Рекрутёр: Здравствуйте, расскажите о себе. Кандидат: Да, конечно…' })
    expect(t).toContain('Здравствуйте')
  })

  it('массив сегментов со спикером и временем в секундах', () => {
    const t = extractTranscriptFromReport({
      title: 'Интервью',
      transcript: [
        { speaker: 'Анна', start: 0, text: 'Добрый день' },
        { speaker: 'Иван', start: 65, text: 'Здравствуйте, рад знакомству' },
      ],
    })
    expect(t).toBe('[00:00] Анна: Добрый день\n[01:05] Иван: Здравствуйте, рад знакомству')
  })

  it('время в миллисекундах нормализуется', () => {
    const t = extractTranscriptFromReport({ segments: [{ speaker_name: 'A', start_time: 125_000, content: 'ok' }, { speaker_name: 'B', start_time: 3_600_000, content: 'да' }] })
    expect(t).toBe('[02:05] A: ok\n[1:00:00] B: да')
  })

  it('вложенный transcript.segments', () => {
    const t = extractTranscriptFromReport({ data: { transcript: { segments: [{ speaker: 'X', text: 'раз' }, { speaker: 'Y', text: 'два' }] } } })
    expect(t).toBe('X: раз\nY: два')
  })

  it('произвольный массив реплик без известного ключа', () => {
    const t = extractTranscriptFromReport({ followup_v2: { templates: [] }, utterancesFromAsr: [{ speaker: 'S1', from: 1, text: 'один' }, { speaker: 'S2', from: 2, text: 'два' }] })
    expect(t).toBe('[00:01] S1: один\n[00:02] S2: два')
  })

  it('не принимает массив, который не похож на речь', () => {
    const t = extractTranscriptFromReport({ speakers: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], followup_v2: { templates: [{ id: 't1', name: 'hr-interview' }] } })
    expect(t).toBeNull()
  })

  it('null на пустом/не-объекте', () => {
    expect(extractTranscriptFromReport(null)).toBeNull()
    expect(extractTranscriptFromReport('x')).toBeNull()
    expect(extractTranscriptFromReport({})).toBeNull()
  })
})

describe('mymeet/rest · summary / duration / participants', () => {
  it('summary из followup_v2.templates[].sections', () => {
    const s = extractSummaryFromReport({
      followup_v2: { templates: [{ id: 't', name: 'hr-interview', sections: [{ name: 'Summary', text: 'Кандидат уверенно отвечал' }] }] },
    })
    expect(s).toBe('Кандидат уверенно отвечал')
  })

  it('summary напрямую приоритетнее', () => {
    expect(extractSummaryFromReport({ summary: 'Прямое', followup_v2: { templates: [{ summary: 'Шаблонное' }] } })).toBe('Прямое')
  })

  it('duration в мс → секунды', () => {
    expect(extractDurationSecFromReport({ duration: 1_800_000 })).toBe(1800)
    expect(extractDurationSecFromReport({ duration: 1800 })).toBe(1800)
    expect(extractDurationSecFromReport({ duration_sec: 90.4 })).toBe(90)
    expect(extractDurationSecFromReport({})).toBeUndefined()
  })

  it('participants / speakers', () => {
    expect(extractParticipantsFromReport({ speakers: [{ name: 'A' }] })).toEqual([{ name: 'A' }])
    expect(extractParticipantsFromReport({ participants: [] })).toBeUndefined()
  })
})
