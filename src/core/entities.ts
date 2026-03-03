import { normalizeForMatch } from './utils'

export type EntityType = 'supplier' | 'customer'

export type Entity = {
  code: string
  name: string
  nif?: string
  keywords?: string
  type: EntityType
}

export type EntitySourceMode = 'local' | 'api'

const LS_KEY = 'primavera_importer_entities_v1'

export function loadLocalEntities(): Entity[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Entity[]
  } catch {
    return []
  }
}

export function saveLocalEntities(entities: Entity[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(entities))
}

export function suggestEntity(description: string, entities: Entity[]): { entity?: Entity; score: number } {
  const d = normalizeForMatch(description)
  let best: Entity | undefined
  let bestScore = 0

  for (const e of entities) {
    const name = normalizeForMatch(e.name)
    let score = 0
    if (d.includes(name) && name.length > 3) score += 70

    const kws = (e.keywords ?? '').split('|').map(s => normalizeForMatch(s)).filter(Boolean)
    for (const kw of kws) {
      if (kw.length > 2 && d.includes(kw)) score = Math.max(score, 90)
    }

    if (e.nif && d.includes(String(e.nif))) score = 100

    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }

  return { entity: best, score: bestScore }
}
