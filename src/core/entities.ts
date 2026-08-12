import { getServerStore, setServerStore } from './server-store'
import { normalizeForMatch } from './utils'

export type EntityType = 'supplier' | 'customer'

export type Entity = {
  code: string
  name: string
  nif?: string
  account?: string
  keywords?: string
  type: EntityType
}

export type EntitySourceMode = 'local' | 'api'

function storageKey(clientId: string) {
  return `primavera_importer_entities_v2_${clientId}`
}

export function loadLocalEntities(clientId: string): Entity[] {
  try {
    const raw = localStorage.getItem(storageKey(clientId))
    if (!raw && clientId === 'vilarinho') {
      const legacy = localStorage.getItem('primavera_importer_entities_v1')
      if (legacy) {
        const entities = JSON.parse(legacy) as Entity[]
        saveLocalEntities(clientId, entities)
        return entities
      }
    }
    if (!raw) return []
    return JSON.parse(raw) as Entity[]
  } catch {
    return []
  }
}

export function saveLocalEntities(clientId: string, entities: Entity[]) {
  try {
    localStorage.setItem(storageKey(clientId), JSON.stringify(entities))
    setServerStore(clientId, 'entities', entities)
    return true
  } catch {
    return false
  }
}

export async function refreshLocalEntitiesFromServer(clientId: string): Promise<Entity[] | null> {
  if (loadLocalEntities(clientId).length > 0) return null
  const remote = await getServerStore<Entity[]>(clientId, 'entities')
  if (!remote || !remote.length) return null
  saveLocalEntities(clientId, remote)
  return remote
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
