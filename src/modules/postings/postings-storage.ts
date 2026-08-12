import { getServerStore, setServerStore } from '../../core/server-store'
import { exactDescriptionKey, prefixDescriptionKey } from './posting-classifier'
import { DescriptionPostingModel, PostingDraft } from './types'

function draftsKey(clientId: string) {
  return `primavera_importer_posting_drafts_v1_${clientId}`
}

function modelsKey(clientId: string) {
  return `primavera_importer_posting_models_v1_${clientId}`
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadPostingDrafts(clientId: string) {
  return read<Record<string, PostingDraft>>(draftsKey(clientId), {})
}

export function savePostingDrafts(clientId: string, drafts: Record<string, PostingDraft>) {
  const ok = write(draftsKey(clientId), drafts)
  setServerStore(clientId, 'posting_drafts', drafts)
  return ok
}

export async function refreshPostingDraftsFromServer(clientId: string): Promise<Record<string, PostingDraft> | null> {
  if (Object.keys(loadPostingDrafts(clientId)).length > 0) return null
  const remote = await getServerStore<Record<string, PostingDraft>>(clientId, 'posting_drafts')
  if (!remote || !Object.keys(remote).length) return null
  write(draftsKey(clientId), remote)
  return remote
}

export function loadDescriptionModels(clientId: string) {
  return read<Record<string, DescriptionPostingModel>>(modelsKey(clientId), {})
}

export function saveDescriptionModels(clientId: string, models: Record<string, DescriptionPostingModel>) {
  const ok = write(modelsKey(clientId), models)
  setServerStore(clientId, 'posting_models', models)
  return ok
}

export async function refreshDescriptionModelsFromServer(clientId: string): Promise<Record<string, DescriptionPostingModel> | null> {
  if (Object.keys(loadDescriptionModels(clientId)).length > 0) return null
  const remote = await getServerStore<Record<string, DescriptionPostingModel>>(clientId, 'posting_models')
  if (!remote || !Object.keys(remote).length) return null
  write(modelsKey(clientId), remote)
  return remote
}

export function suggestFromModels(
  description: string,
  models: Record<string, DescriptionPostingModel>,
): Partial<Pick<PostingDraft, 'counterAccount' | 'journal' | 'documentType'>> {
  const exact = models[exactDescriptionKey(description)]
  const prefix = models[prefixDescriptionKey(description)]
  const learned = exact ?? prefix
  if (!learned) return {}
  return { counterAccount: learned.counterAccount, journal: learned.journal, documentType: learned.documentType }
}

export function rememberDescriptionModel(
  description: string,
  draft: Pick<PostingDraft, 'counterAccount' | 'journal' | 'documentType'>,
  models: Record<string, DescriptionPostingModel>,
): Record<string, DescriptionPostingModel> {
  if (!draft.counterAccount.trim()) return models
  const updatedAt = new Date().toISOString()
  const model: DescriptionPostingModel = { key: '', counterAccount: draft.counterAccount, journal: draft.journal, documentType: draft.documentType, updatedAt }
  return {
    ...models,
    [exactDescriptionKey(description)]: { ...model, key: exactDescriptionKey(description) },
    [prefixDescriptionKey(description)]: { ...model, key: prefixDescriptionKey(description) },
  }
}
