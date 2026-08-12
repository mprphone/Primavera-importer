import { getServerStore, setServerStore } from '../../core/server-store'
import { AccountVatModel, CategoryPostingModel, PurchaseInvoice, SupplierPostingModel } from './types'

function invoiceKey(clientId: string) {
  return `primavera_importer_purchases_v1_${clientId}`
}

function modelKey(clientId: string) {
  return `primavera_importer_supplier_models_v1_${clientId}`
}

function categoryModelKey(clientId: string) {
  return `primavera_importer_category_models_v1_${clientId}`
}

function accountVatKey(clientId: string) {
  return `primavera_importer_account_vat_v1_${clientId}`
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

// Faturas gravadas por versões antigas da app podem não ter todos os campos atuais (ex:
// vatCode/paid/paymentAccount foram adicionados depois) — normaliza para nunca propagar undefined
// para código que assume strings, o que rebentava silenciosamente em .trim().
function normalizeInvoice(invoice: PurchaseInvoice): PurchaseInvoice {
  return {
    ...invoice,
    expenseAccount: invoice.expenseAccount ?? '',
    vatCode: invoice.vatCode ?? '',
    supplierAccount: invoice.supplierAccount ?? '',
    journal: invoice.journal ?? '',
    documentType: invoice.documentType ?? '',
    paymentAccount: invoice.paymentAccount ?? '',
    paid: invoice.paid ?? false,
    reviewedAt: invoice.reviewedAt ?? '',
  }
}

export function loadPurchases(clientId: string) {
  return read<PurchaseInvoice[]>(invoiceKey(clientId), []).map(normalizeInvoice)
}

// Duas janelas (ex.: o PC do cliente e o teu, ambos abertos ao mesmo tempo) podem gravar em
// momentos próximos. Publicar sempre o array local, sem antes ver o que já está no servidor,
// deixa a última gravação apagar silenciosamente uma verificação feita entretanto noutro PC —
// confirmado num caso real: a verificação SQL de um mês inteiro, feita no PC do cliente,
// desapareceu do servidor depois de uma gravação feita a partir de outro PC com dados mais
// antigos desse mês, sem qualquer aviso a ninguém. Isto junta com o servidor mesmo antes de cada
// publicação para nunca perder uma verificação já concluída noutro lado.
async function pushPurchasesToServer(clientId: string, invoices: PurchaseInvoice[]) {
  const remote = await getServerStore<PurchaseInvoice[]>(clientId, 'purchases')
  const merged = remote?.length ? mergePurchaseCopies(invoices, remote) : invoices
  if (merged !== invoices) write(invoiceKey(clientId), merged)
  await setServerStore(clientId, 'purchases', merged)
}

export function savePurchases(clientId: string, invoices: PurchaseInvoice[]) {
  const ok = write(invoiceKey(clientId), invoices)
  void pushPurchasesToServer(clientId, invoices)
  return ok
}

function verificationSourceRank(invoice?: PurchaseInvoice) {
  const source = invoice?.sqlVerification?.source ?? 'sql'
  return source === 'manual' ? 3 : source === 'saft' ? 2 : 1
}

function verificationStatusRank(invoice?: PurchaseInvoice) {
  const status = invoice?.sqlVerification?.status
  return status === 'confirmed' ? 3 : status === 'possible' ? 2 : status === 'missing' ? 1 : 0
}

function verificationTime(invoice?: PurchaseInvoice) {
  const timestamp = Date.parse(invoice?.sqlVerification?.checkedAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

/**
 * Junta as cópias de dois navegadores sem perder uma verificação já concluída. A fonte de maior
 * confiança (manual > SAF-T > SQL) ganha; dentro da mesma fonte ganha a verificação mais recente.
 * Este comportamento é deliberadamente independente do resto dos campos editáveis da fatura.
 */
export function mergePurchaseCopies(local: PurchaseInvoice[], remote: PurchaseInvoice[]) {
  const localByKey = new Map(local.map(invoice => [invoice.sourceKey || invoice.id, normalizeInvoice(invoice)]))
  const remoteByKey = new Map(remote.map(invoice => [invoice.sourceKey || invoice.id, normalizeInvoice(invoice)]))
  const orderedKeys = [
    ...localByKey.keys(),
    ...Array.from(remoteByKey.keys()).filter(key => !localByKey.has(key)),
  ]

  return orderedKeys.map(key => {
    const localInvoice = localByKey.get(key)
    const remoteInvoice = remoteByKey.get(key)
    if (!localInvoice) return remoteInvoice!
    if (!remoteInvoice) return localInvoice

    // Mantém os campos que o utilizador possa ter editado neste navegador, mas decide a
    // verificação separadamente para uma cópia local antiga nunca apagar o resultado do servidor.
    const merged: PurchaseInvoice = { ...remoteInvoice, ...localInvoice }
    const localHasVerification = Boolean(localInvoice.sqlVerification)
    const remoteHasVerification = Boolean(remoteInvoice.sqlVerification)
    let verificationOwner: PurchaseInvoice | undefined
    if (!localHasVerification) verificationOwner = remoteHasVerification ? remoteInvoice : undefined
    else if (!remoteHasVerification) verificationOwner = localInvoice
    else {
      const localSource = verificationSourceRank(localInvoice)
      const remoteSource = verificationSourceRank(remoteInvoice)
      if (localSource !== remoteSource) verificationOwner = localSource > remoteSource ? localInvoice : remoteInvoice
      else {
        const localTime = verificationTime(localInvoice)
        const remoteTime = verificationTime(remoteInvoice)
        if (localTime !== remoteTime) verificationOwner = localTime > remoteTime ? localInvoice : remoteInvoice
        else verificationOwner = verificationStatusRank(localInvoice) >= verificationStatusRank(remoteInvoice)
          ? localInvoice
          : remoteInvoice
      }
    }

    merged.sqlVerification = verificationOwner?.sqlVerification
    if (merged.sqlVerification?.status === 'confirmed') {
      merged.status = 'exported'
      merged.selected = false
      merged.exportedAt ||= verificationOwner?.exportedAt
    }

    // "Exportado" (via TXT manual, não via confirmação SQL — essa já fica protegida acima) é uma
    // transição só de um lado: nunca deve reverter-se sozinha. O spread ingénuo em cima dá sempre
    // o campo status à cópia local, mesmo quando essa cópia nunca chegou a saber do export (nem
    // tinha exportedAt) — confirmado em produção: a funcionária exportou no PC do cliente e a
    // sincronização a partir de outro PC, com uma cópia mais antiga, reabria-a sozinha sem
    // ninguém pedir. Só decide aqui quando os dois lados discordam; invoices onde já concordam
    // ficam exatamente como estavam.
    if (localInvoice.status !== remoteInvoice.status) {
      const latestExportedAt = [localInvoice.exportedAt, remoteInvoice.exportedAt].filter(Boolean).sort().pop()
      const latestReopenedAt = [localInvoice.reopenedAt, remoteInvoice.reopenedAt].filter(Boolean).sort().pop()
      const shouldBeExported = Boolean(latestExportedAt && (!latestReopenedAt || latestExportedAt > latestReopenedAt))
      merged.status = shouldBeExported ? 'exported' : 'pending'
      merged.exportedAt = shouldBeExported ? latestExportedAt : undefined
      if (shouldBeExported) merged.selected = false
    }
    merged.reopenedAt = [localInvoice.reopenedAt, remoteInvoice.reopenedAt].filter(Boolean).sort().pop()
    return merged
  })
}

export async function refreshPurchasesFromServer(clientId: string): Promise<PurchaseInvoice[] | null> {
  const local = loadPurchases(clientId)
  const remote = await getServerStore<PurchaseInvoice[]>(clientId, 'purchases')
  if (!remote || !remote.length) return null
  const merged = mergePurchaseCopies(local, remote)
  write(invoiceKey(clientId), merged)
  // Publica a união para recuperar também faturas/validações que só existissem neste navegador.
  // As escritas ficam serializadas por setServerStore, por isso esta reparação não pode ultrapassar
  // uma alteração posterior feita pelo mesmo utilizador.
  if (JSON.stringify(merged) !== JSON.stringify(remote)) setServerStore(clientId, 'purchases', merged)
  return merged
}

export function mergePurchases(current: PurchaseInvoice[], imported: PurchaseInvoice[]) {
  const byKey = new Map(current.map(invoice => [invoice.sourceKey, invoice]))
  let added = 0
  let duplicates = 0
  for (const invoice of imported) {
    if (byKey.has(invoice.sourceKey)) {
      duplicates += 1
      continue
    }
    byKey.set(invoice.sourceKey, invoice)
    added += 1
  }
  return { invoices: Array.from(byKey.values()), added, duplicates }
}

export function loadSupplierModels(clientId: string) {
  return read<Record<string, SupplierPostingModel>>(modelKey(clientId), {})
}

export function saveSupplierModels(clientId: string, models: Record<string, SupplierPostingModel>) {
  const ok = write(modelKey(clientId), models)
  setServerStore(clientId, 'supplier_models', models)
  return ok
}

export async function refreshSupplierModelsFromServer(clientId: string): Promise<Record<string, SupplierPostingModel> | null> {
  const local = loadSupplierModels(clientId)
  const remote = await getServerStore<Record<string, SupplierPostingModel>>(clientId, 'supplier_models')
  if (!remote || !Object.keys(remote).length) return null
  // O servidor pode receber modelos históricos extraídos do SAF-T. Junta-os aos aprendidos neste
  // navegador sem substituir decisões locais já confirmadas pelo utilizador.
  const merged = { ...remote, ...local }
  write(modelKey(clientId), merged)
  return merged
}

export function applySupplierModel(invoice: PurchaseInvoice, model?: SupplierPostingModel): PurchaseInvoice {
  if (!model) return invoice
  const confirmations = model.confirmations ?? 1
  const corrections = model.corrections ?? 0
  const confidence = Math.max(45, Math.min(97, 58 + confirmations * 12 - corrections * 15))
  return {
    ...invoice,
    // Sugestões nunca apagam escolhas já preenchidas manualmente.
    expenseAccount: invoice.expenseAccount || model.expenseAccount,
    vatCode: invoice.vatCode || model.vatCode,
    supplierAccount: invoice.supplierAccount || model.supplierAccount,
    journal: invoice.journal || model.journal,
    documentType: invoice.documentType || model.documentType,
    intelligence: invoice.intelligence && invoice.intelligence.confidence > confidence
      ? invoice.intelligence
      : {
          confidence,
          evidence: confirmations > 1
            ? `mesmo modelo confirmado em ${confirmations} lançamentos deste fornecedor`
            : 'modelo usado anteriormente neste fornecedor; confirmar antes de exportar',
        },
  }
}

export function loadCategoryModels(clientId: string) {
  return read<Record<string, CategoryPostingModel>>(categoryModelKey(clientId), {})
}

export function saveCategoryModels(clientId: string, models: Record<string, CategoryPostingModel>) {
  const ok = write(categoryModelKey(clientId), models)
  setServerStore(clientId, 'category_models', models)
  return ok
}

export async function refreshCategoryModelsFromServer(clientId: string): Promise<Record<string, CategoryPostingModel> | null> {
  if (Object.keys(loadCategoryModels(clientId)).length > 0) return null
  const remote = await getServerStore<Record<string, CategoryPostingModel>>(clientId, 'category_models')
  if (!remote || !Object.keys(remote).length) return null
  write(categoryModelKey(clientId), remote)
  return remote
}

export function applyCategoryModel(invoice: PurchaseInvoice, model?: CategoryPostingModel): PurchaseInvoice {
  if (!model || invoice.expenseAccount) return invoice
  return { ...invoice, expenseAccount: model.expenseAccount }
}

export function loadAccountVatMap(clientId: string) {
  return read<Record<string, AccountVatModel>>(accountVatKey(clientId), {})
}

export function saveAccountVatMap(clientId: string, map: Record<string, AccountVatModel>) {
  const ok = write(accountVatKey(clientId), map)
  setServerStore(clientId, 'account_vat', map)
  return ok
}

export async function refreshAccountVatMapFromServer(clientId: string): Promise<Record<string, AccountVatModel> | null> {
  if (Object.keys(loadAccountVatMap(clientId)).length > 0) return null
  const remote = await getServerStore<Record<string, AccountVatModel>>(clientId, 'account_vat')
  if (!remote || !Object.keys(remote).length) return null
  write(accountVatKey(clientId), remote)
  return remote
}

export function applyAccountVat(invoice: PurchaseInvoice, map: Record<string, AccountVatModel>): PurchaseInvoice {
  if (invoice.vatCode || !invoice.expenseAccount) return invoice
  const learned = map[invoice.expenseAccount]
  return learned ? { ...invoice, vatCode: learned.vatCode } : invoice
}
