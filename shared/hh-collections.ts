export const HH_COLLECTION_LABELS: Record<string, string> = {
  response: 'Отклик',
  consider: 'Подумать',
  phone_interview: 'Телефонное интервью',
  assessment: 'Тестовое задание',
  interview: 'Интервью',
  offer: 'Оффер',
  hired: 'Нанят',
  discard_by_employer: 'Отказ',
  discard_visible_by_opponent: 'Отказ (видимый кандидату)',
  discard_after_interview: 'Отказ после интервью',
}

export const HH_COLLECTION_OPTIONS = Object.entries(HH_COLLECTION_LABELS).map(([value, label]) => ({
  value,
  label,
}))
