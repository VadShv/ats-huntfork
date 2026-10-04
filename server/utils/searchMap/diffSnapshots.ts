/**
 * diffSnapshots — сравнение двух снапшотов карты.
 * Возвращает added/removed/changed для секций, доноров и сегментов.
 */

type Snapshot = {
  sections?: { title: string; items: { value: string }[] }[]
  donors?: { donorCompanyId: string; layer: string; priority: string }[]
  segments?: { name: string; donorLayer?: string | null; titles: string[]; geo: string[]; priority: string }[]
}

export function diffSnapshots(oldSnap: Snapshot, newSnap: Snapshot) {
  return {
    sections: diffSections(oldSnap.sections ?? [], newSnap.sections ?? []),
    donors: diffDonors(oldSnap.donors ?? [], newSnap.donors ?? []),
    segments: diffSegments(oldSnap.segments ?? [], newSnap.segments ?? []),
  }
}

function diffSections(oldList: Snapshot['sections']!, newList: Snapshot['sections']!) {
  const result: { title: string; added: string[]; removed: string[] }[] = []
  const oldMap = new Map(oldList.map(s => [s.title, s]))
  const newMap = new Map(newList.map(s => [s.title, s]))
  const allTitles = new Set([...oldMap.keys(), ...newMap.keys()])

  for (const title of allTitles) {
    const oldS = oldMap.get(title)
    const newS = newMap.get(title)
    if (oldS && newS) {
      const oldVals = new Set(oldS.items.map(i => i.value.toLowerCase()))
      const newVals = new Set(newS.items.map(i => i.value.toLowerCase()))
      const added = newS.items.filter(i => !oldVals.has(i.value.toLowerCase())).map(i => i.value)
      const removed = oldS.items.filter(i => !newVals.has(i.value.toLowerCase())).map(i => i.value)
      if (added.length || removed.length) result.push({ title, added, removed })
    } else if (newS) {
      result.push({ title, added: newS.items.map(i => i.value), removed: [] })
    } else if (oldS) {
      result.push({ title, added: [], removed: oldS.items.map(i => i.value) })
    }
  }
  return result
}

function diffDonors(oldList: Snapshot['donors']!, newList: Snapshot['donors']!) {
  const oldMap = new Map(oldList.map(d => [d.donorCompanyId, d]))
  const newMap = new Map(newList.map(d => [d.donorCompanyId, d]))
  const added = newList.filter(d => !oldMap.has(d.donorCompanyId))
  const removed = oldList.filter(d => !newMap.has(d.donorCompanyId))
  const changed = newList.filter(d => {
    const old = oldMap.get(d.donorCompanyId)
    return old && (old.layer !== d.layer || old.priority !== d.priority)
  })
  return { added, removed, changed }
}

function diffSegments(oldList: Snapshot['segments']!, newList: Snapshot['segments']!) {
  const oldMap = new Map(oldList.map(s => [s.name, s]))
  const newMap = new Map(newList.map(s => [s.name, s]))
  const added = newList.filter(s => !oldMap.has(s.name))
  const removed = oldList.filter(s => !newMap.has(s.name))
  const changed = newList.filter(s => {
    const old = oldMap.get(s.name)
    if (!old) return false
    return JSON.stringify(old) !== JSON.stringify(s)
  })
  return { added, removed, changed }
}
