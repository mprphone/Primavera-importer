import { LedgerMovement } from '../../core/primavera'
import { PurchaseInvoice } from './types'

export type PurchaseSqlMatch = {
  kind: 'confirmed' | 'possible' | 'missing'
  movement?: LedgerMovement
  evidence: string
  // Marca correspondências encontradas só pelo valor, dentro de um lançamento em lote (sem
  // documento nem fornecedor a confirmar) — o mesmo valor pode calhar a mais do que uma fatura por
  // coincidência, por isso a UI mostra isto com uma cor distinta da revisão normal.
  lowConfidence?: boolean
  // Diferença de total tolerada (máximo 0,02 €) porque a conta ligada ao NIF coincide.
  amountDifference?: number
  // Correspondência pelo fornecedor indicado no movimento, lançado diretamente no banco.
  directBank?: boolean
  posting?: PurchaseLedgerPosting
}

export type PurchaseLedgerPosting = {
  journal: string
  number: string
  date: string
  accounts: Array<{
    account: string
    debit: number
    credit: number
    entityType?: string
    entityCode?: string
  }>
}

function normalized(value: string) {
  return value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '')
}

function withoutPortalValidation(value: string) {
  // O e-Fatura acrescenta " / JXXXXXXXX-número" à referência fiscal. Esse código de validação
  // não é guardado no lançamento contabilístico da HELBOR.
  return value.replace(/\s+\/\s+J[A-Z0-9]{7,}(?:-[A-Z0-9]+)?\s*$/i, '').trim()
}

function withoutLedgerPrefix(value: string) {
  // O Primavera identifica o tipo de lançamento no início da referência: "V/Fatura ", "V/FR "
  // (HELBOR) ou o padrão mais comum "<TIPO> <ANO>/" — ex. "VFA 2026/", "VFS 2026/", "VNC 2026/"
  // (JACTIGAS, e provavelmente outras empresas). O prefixo descreve a operação/ano fiscal, não
  // faz parte do documento do fornecedor.
  return value
    .replace(/^V\/(?:FATURA|FACTURA|FR|NC|N\.C\.)\s*/i, '')
    .replace(/^[A-Z]{1,4}\s+\d{4}\/\s*/i, '')
    .trim()
}

function documentSerial(value: string) {
  const clean = withoutLedgerPrefix(withoutPortalValidation(value))
  const tail = clean.split('/').pop() ?? ''
  return normalized(tail).replace(/^0+/, '')
}

function documentMatch(invoiceDocument: string, movement: LedgerMovement): 'full' | 'serial' | 'none' {
  const wanted = normalized(withoutPortalValidation(invoiceDocument))
  const candidates = [movement.reference, movement.description]
    .map(withoutLedgerPrefix)
    .filter(Boolean)
  if (wanted.length >= 5 && candidates.some(value => {
    const candidate = normalized(value)
    return candidate.length >= 5 && (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate))
  })) return 'full'

  const wantedSerial = documentSerial(invoiceDocument)
  if (wantedSerial.length >= 3 && candidates.some(value => {
    const candidateSerial = documentSerial(value)
    if (candidateSerial === wantedSerial) return true
    // É frequente ser introduzido apenas o fim do número do documento no Primavera. Quatro
    // caracteres finais, combinados com fornecedor/valor/data, são úteis para desempatar sem
    // exigir que a referência contabilística reproduza a série completa do e-Fatura.
    const shorter = candidateSerial.length < wantedSerial.length ? candidateSerial : wantedSerial
    const longer = candidateSerial.length < wantedSerial.length ? wantedSerial : candidateSerial
    return shorter.length >= 4 && longer.endsWith(shorter)
  })) return 'serial'
  return 'none'
}

function dayDistance(left: string, right: string) {
  const a = Date.parse(`${left.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${right.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86_400_000 : Infinity
}

type MovementGroup = { representative: LedgerMovement; lines: LedgerMovement[] }

// A mesma resposta do razão é comparada com centenas de faturas. Sem cache, cada comparação
// reconstruía todos os lançamentos a partir de mais de 170 mil linhas, bloqueando o browser por
// vários minutos. A chave é o próprio array devolvido pelo conector; WeakMap liberta-o quando a
// verificação termina.
const groupedMovementsCache = new WeakMap<LedgerMovement[], MovementGroup[]>()

// Conta corrente de fornecedores (22) ou outros devedores/credores (27) — consoante a empresa, a
// liquidação de uma compra é lançada numa ou na outra (e por vezes vai direta ao banco, sem
// nenhuma delas aparecer na mesma linha que a fatura).
export function isPayableAccount(account?: string) {
  return /^2[27]/.test(account ?? '')
}

function groupTransactionLines(movements: LedgerMovement[]): MovementGroup[] {
  const cached = groupedMovementsCache.get(movements)
  if (cached) return cached

  // Uma compra pode estar dentro de um lançamento composto: no SAF-T da HELBOR, duas ou mais
  // linhas do mesmo documento podem somar o total individual da fatura.
  const grouped = new Map<string, MovementGroup>()
  movements.forEach(movement => {
    const description = normalized(withoutLedgerPrefix(movement.description || movement.reference))
    const reference = normalized(movement.reference)
    const postingIdentity = movement.journal || movement.postingNumber
      ? `${movement.journal ?? ''}|${movement.postingNumber ?? ''}`
      : `${description}|${reference}`
    const key = `${movement.date}|${postingIdentity}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, { representative: movement, lines: [movement] })
      return
    }
    existing.lines.push(movement)
    // Quando existe, conserva a linha da conta de fornecedor/credor para poder corrigir a ficha.
    if (!isPayableAccount(existing.representative.account) && isPayableAccount(movement.account)) existing.representative = movement
  })
  const result = Array.from(grouped.values())
  groupedMovementsCache.set(movements, result)
  return result
}

function cents(value: number) {
  return Math.round(Math.abs(value) * 100)
}

const NIF_AMOUNT_TOLERANCE_CENTS = 2

function sameAccount(left?: string, right?: string) {
  return Boolean(left?.trim() && right?.trim() && left.trim().toUpperCase() === right.trim().toUpperCase())
}

function groupHasAccount(group: MovementGroup, account: string) {
  return group.lines.some(line => sameAccount(line.account, account))
}

function normalizedEntityCode(value?: string) {
  const clean = (value ?? '').trim().toUpperCase()
  return /^\d+$/.test(clean) ? clean.replace(/^0+(?=\d)/, '') : clean
}

function isSupplierEntityType(value?: string) {
  const clean = normalized(value ?? '')
  // Algumas instalações guardam F, outras a descrição completa ou o código 2 da tabela de
  // fornecedores. Se o tipo não existir, o código continua a ser comparado exclusivamente com
  // uma ficha de fornecedor já resolvida pelo NIF.
  return !clean || clean === 'F' || clean === 'FORNECEDOR' || clean === 'SUPPLIER' || clean === '2'
}

function sameEntityCode(left?: string, right?: string) {
  const a = normalizedEntityCode(left)
  const b = normalizedEntityCode(right)
  return Boolean(a && b && a === b)
}

function groupHasSupplierEntity(group: MovementGroup, entityCode: string) {
  return group.lines.some(line => isSupplierEntityType(line.entityType) && sameEntityCode(line.entityCode, entityCode))
}

function supplierEntityMovement(group: MovementGroup, entityCode: string) {
  return group.lines.find(line => isSupplierEntityType(line.entityType) && sameEntityCode(line.entityCode, entityCode))
}

function isDirectBankPosting(group: MovementGroup) {
  return !group.lines.some(line => isPayableAccount(line.account))
    && group.lines.some(line => /^12/.test(line.account?.trim() ?? ''))
}

function amountDifferenceForAccount(group: MovementGroup, account: string, total: number) {
  const balance = group.lines.reduce((sum, line) => sameAccount(line.account, account)
    ? sum + line.debit - line.credit
    : sum, 0)
  return Math.abs(cents(balance) - cents(total))
}

function amountDifferenceForGroup(group: MovementGroup, total: number) {
  const wanted = cents(total)
  const amounts = group.lines.flatMap(line => [line.debit, line.credit]).map(cents).filter(Boolean)
  return amounts.length ? Math.min(...amounts.map(value => Math.abs(value - wanted))) : Infinity
}

function subsetMatches(values: number[], target: number) {
  const wanted = cents(target)
  const usable = values.map(cents).filter(Boolean)
  if (usable.some(value => value === wanted)) return true
  // Evita explosão combinatória em lançamentos de lote muito grandes. Nesses casos, uma linha ou
  // um par ainda cobre os padrões observados nos SAF-T sem bloquear o browser.
  if (usable.length > 12) {
    return usable.some((value, index) => usable.slice(index + 1).some(other => value + other === wanted))
  }
  let sums = new Set([0])
  for (const value of usable) {
    const next = new Set(sums)
    for (const sum of sums) if (sum + value <= wanted) next.add(sum + value)
    sums = next
    if (sums.has(wanted)) return true
  }
  return false
}

function groupAmountMatches(group: MovementGroup, total: number) {
  // Notas de crédito por vezes ficam gravadas na SQL do Primavera como "storno" — o mesmo lado
  // débito/crédito da fatura original, mas com o valor negativo, em vez de trocar de lado. Por
  // isso não se pode filtrar só valor > 0 aqui: cents() já faz Math.abs(), o que interessa é
  // excluir zeros, não negativos.
  const debits = group.lines.map(line => line.debit).filter(value => value !== 0)
  const credits = group.lines.map(line => line.credit).filter(value => value !== 0)
  return subsetMatches(debits, total) || subsetMatches(credits, total)
}

function groupDocumentMatch(invoiceDocument: string, group: MovementGroup) {
  const matches = group.lines.map(line => documentMatch(invoiceDocument, line))
  return matches.includes('full') ? 'full' : matches.includes('serial') ? 'serial' : 'none'
}

function postingOf(group: MovementGroup) {
  const representative = group.representative
  const byAccount = new Map<string, {
    account: string
    debit: number
    credit: number
    entityType?: string
    entityCode?: string
  }>()
  group.lines.forEach(line => {
    if (!line.account) return
    // Num pagamento em lote, a mesma conta bancária pode ter linhas de fornecedores diferentes.
    // Mantém essas entidades separadas para não esconder a que permitiu reconciliar a fatura.
    const accountEntityKey = `${line.account}|${line.entityType ?? ''}|${line.entityCode ?? ''}`
    const current = byAccount.get(accountEntityKey) ?? {
      account: line.account,
      debit: 0,
      credit: 0,
      entityType: line.entityType,
      entityCode: line.entityCode,
    }
    current.debit += line.debit
    current.credit += line.credit
    current.entityType ||= line.entityType
    current.entityCode ||= line.entityCode
    byAccount.set(accountEntityKey, current)
  })
  return {
    journal: representative.journal ?? '',
    number: representative.postingNumber ?? representative.reference ?? representative.id,
    date: representative.date,
    accounts: Array.from(byAccount.values()),
  }
}

export function groupPurchaseLedgerPostings(movements: LedgerMovement[]): PurchaseLedgerPosting[] {
  return groupTransactionLines(movements).map(postingOf)
}

type ConsolidatedSupplierGroup = { key: string; label: string; companyCodes: Set<string>; nifs: Set<string>; verified: boolean }

// Grupos de fornecedores cuja liquidação a Primavera não lança fatura a fatura, mas sim um único
// lançamento mensal a somar tudo. A verificação, nestes casos, só pode ser feita por mês: soma
// das faturas do grupo nesse mês == lançamento consolidado desse mês. Cada grupo está limitado às
// empresas onde o padrão foi mesmo observado — o mesmo fornecedor pode ser lançado fatura a fatura
// noutra empresa, consoante o hábito de quem lança.
const CONSOLIDATED_SUPPLIER_GROUPS: ConsolidatedSupplierGroup[] = [
  {
    key: 'ctt',
    label: 'CTT - Correios de Portugal, S.A.',
    // Confirmado num SAF-T real (JACTIGAS): cada franquia comprada em numerário ao longo do mês é
    // somada num único lançamento no último dia do mês (débito na conta de despesas postais,
    // crédito em Caixa), sem qualquer referência ao número do documento nem à conta de fornecedor.
    verified: true,
    companyCodes: new Set(['jactigas']),
    nifs: new Set(['500077568']),
  },
  {
    key: 'via-verde',
    label: 'Via Verde (portagens de várias concessionárias)',
    // Cada concessionária emite o seu próprio documento (NIFs diferentes). Na JACTIGAS tenta-se
    // sempre primeiro a correspondência individual. Se a referência da fatura não estiver no
    // lançamento, o total pode ainda ser reconhecido numa linha individual da conta de pagamento
    // dentro do lançamento de portagens (base em 625112, descrição "VIA VERDE"). Só o que
    // continuar por resolver chega à regra mensal antiga.
    verified: false,
    companyCodes: new Set(['jactigas']),
    nifs: new Set([
      '502790024', // Brisa Concessão Rodoviária, S.A.
      '503933813', // Infraestruturas de Portugal, S.A.
      '504656767', // Via Verde Portugal — Gestão de Sistemas Electrónicos de Cobrança, S.A.
      '507027140', // AEDL — Auto-Estradas do Douro Litoral, S.A.
      '513701311', // ePorto, Estacionamentos Públicos do Porto, S.A.
      '503174688', // Lusoponte — Concessionária para a Travessia do Tejo, S.A.
      '504488643', // Ascendi Norte — Auto-Estradas do Norte, S.A.
      '506252043', // Ascendi Grande Porto — Auto Estradas do Grande Porto, S.A.
      '507959248', // Ascendi Grande Lisboa — Auto Estradas da Grande Lisboa, S.A.
      '504853694', // Ascendi Costa de Prata — Auto Estradas da Costa de Prata, S.A.
      '509397913', // Ascendi Pinhal Interior — Estradas do Pinhal Interior, S.A.
    ]),
  },
]

function findConsolidationGroup(companyCode: string, supplierNif?: string) {
  if (!supplierNif) return undefined
  return CONSOLIDATED_SUPPLIER_GROUPS.find(group => group.companyCodes.has(companyCode) && group.nifs.has(supplierNif))
}

export function hasMonthlyConsolidatedPosting(companyCode: string, supplierNif?: string) {
  return Boolean(findConsolidationGroup(companyCode, supplierNif))
}

export function prefersIndividualPurchaseMatch(companyCode: string, supplierNif?: string) {
  return findConsolidationGroup(companyCode, supplierNif)?.key === 'via-verde'
}

function monthKey(dateIso: string) {
  return dateIso.slice(0, 7)
}

type ViaVerdeLineCandidate = {
  group: MovementGroup
  line: LedgerMovement
}

// Na JACTIGAS, a Via Verde é lançada por matrícula: várias faturas podem ficar dentro do mesmo
// número de lançamento. Cada total de fatura continua, contudo, numa linha individual a crédito
// da conta de pagamento, enquanto a base vai para 625112 e o IVA para 243.... Esta regra fica
// deliberadamente limitada ao grupo/NIFs Via Verde definido acima.
function matchViaVerdeInvoiceLines(
  invoices: PurchaseInvoice[],
  groups: MovementGroup[],
  month: string,
): Map<string, PurchaseSqlMatch> {
  const results = new Map<string, PurchaseSqlMatch>()
  const candidates: ViaVerdeLineCandidate[] = []

  groups.forEach(group => {
    if (monthKey(group.representative.date) !== month) return
    const isViaVerdePosting = group.lines.some(line =>
      (line.account ?? '').trim() === '625112'
      && /via\s*verde/i.test(`${line.description ?? ''} ${line.reference ?? ''}`),
    )
    if (!isViaVerdePosting) return
    group.lines.forEach(line => {
      const account = (line.account ?? '').trim()
      // Exclui as linhas da base e do IVA. O total individual da fatura está do outro lado do
      // lançamento (ex.: 2511111), mesmo quando várias faturas partilham o mesmo lançamento.
      if (account === '625112' || account.startsWith('243')) return
      if (!line.debit && !line.credit) return
      candidates.push({ group, line })
    })
  })

  invoices.forEach(invoice => {
    const creditNote = isCreditNote(invoice)
    const index = candidates.findIndex(({ line }) =>
      cents(creditNote ? line.debit : line.credit) === cents(invoice.totalAmount),
    )
    if (index === -1) return
    const [{ group, line }] = candidates.splice(index, 1)
    results.set(invoice.id, {
      kind: 'confirmed',
      movement: line,
      posting: postingOf(group),
      evidence: 'Via Verde: valor total exato encontrado numa linha individual do lançamento de portagens do mesmo mês (conta 625112, descrição “VIA VERDE”).',
    })
  })

  return results
}

export function matchViaVerdeIndividualPurchases(
  companyCode: string,
  invoices: PurchaseInvoice[],
  movements: LedgerMovement[],
): Map<string, PurchaseSqlMatch> {
  const results = new Map<string, PurchaseSqlMatch>()
  const groups = groupTransactionLines(movements)
  const byMonth = new Map<string, PurchaseInvoice[]>()

  invoices.forEach(invoice => {
    if (!prefersIndividualPurchaseMatch(companyCode, invoice.supplierNif)) return
    const month = monthKey(invoice.documentDate)
    byMonth.set(month, [...(byMonth.get(month) ?? []), invoice])
  })
  byMonth.forEach((monthInvoices, month) => {
    matchViaVerdeInvoiceLines(monthInvoices, groups, month)
      .forEach((match, invoiceId) => results.set(invoiceId, match))
  })
  return results
}

export function matchMonthlyConsolidatedPurchases(
  companyCode: string,
  invoices: PurchaseInvoice[],
  movements: LedgerMovement[],
): Map<string, PurchaseSqlMatch> {
  const results = new Map<string, PurchaseSqlMatch>()
  const groups = groupTransactionLines(movements)
  const buckets = new Map<string, { label: string; month: string; invoices: PurchaseInvoice[] }>()
  invoices.forEach(invoice => {
    const group = findConsolidationGroup(companyCode, invoice.supplierNif)
    if (!group) return
    const month = monthKey(invoice.documentDate)
    const key = `${group.key}|${month}`
    const bucket = buckets.get(key) ?? { label: group.label, month, invoices: [] }
    bucket.invoices.push(invoice)
    buckets.set(key, bucket)
  })

  buckets.forEach(({ label, month, invoices: bucketInvoices }) => {
    const total = bucketInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0)
    const sameMonth = groups.filter(group => monthKey(group.representative.date) === month)
    const matching = sameMonth.filter(group => groupAmountMatches(group, total))

    if (matching.length === 1) {
      const posting = postingOf(matching[0])
      bucketInvoices.forEach(invoice => results.set(invoice.id, {
        kind: 'confirmed',
        movement: matching[0].representative,
        posting,
        evidence: `${label}: lançado num único movimento mensal (não fatura a fatura). O total das ${bucketInvoices.length} fatura(s) de ${month} bate com o lançamento consolidado desse mês.`,
      }))
      return
    }

    const evidence = matching.length > 1
      ? `${label}: lançado por mês. Há mais do que um lançamento de ${month} cujo total bate com a soma das faturas desse mês; requer revisão manual.`
      : `${label}: lançado por mês. Não foi encontrado nenhum lançamento de ${month} cujo total bata com a soma das faturas desse mês (${total.toFixed(2)}€).`
    bucketInvoices.forEach(invoice => results.set(invoice.id, {
      kind: matching.length > 1 ? 'possible' : 'missing',
      evidence,
    }))
  })

  return results
}

type LumpAccountFallback = { key: string; label: string; companyCodes: Set<string>; account: string }

// Contas onde a Primavera lança um total em lote (várias despesas pequenas somadas), mas cada
// despesa individual ainda aparece como uma linha à parte dentro do MESMO lançamento (ex.: um
// recibo de almoço por linha, sem nome nem documento). Confirmado num SAF-T real (JACTIGAS, conta
// 625111 "Alimentação"): o lançamento mensal tem uma linha de débito com o total e várias linhas
// de crédito, uma por recibo. Só usamos as linhas DESTE lançamento, nunca o resto do razão — o
// mesmo valor pode calhar a outra despesa qualquer só por coincidência.
const LUMP_ACCOUNT_FALLBACKS: LumpAccountFallback[] = [
  {
    key: 'refeicoes',
    label: 'Alimentação — reconhecida pelo valor dentro do lançamento do mês, sem documento nem NIF fixo',
    companyCodes: new Set(['jactigas']),
    account: '625111',
  },
]

// Fallback de último recurso: só corre para faturas que já ficaram "missing" nas verificações
// anteriores, e nunca confirma sozinho (o valor sozinho não é prova suficiente — pode coincidir
// com uma fatura de outro fornecedor, como já aconteceu num teste real com portagens e CTT).
export function matchAgainstLumpAccountLines(
  companyCode: string,
  invoices: PurchaseInvoice[],
  movements: LedgerMovement[],
): Map<string, PurchaseSqlMatch> {
  const results = new Map<string, PurchaseSqlMatch>()
  const fallback = LUMP_ACCOUNT_FALLBACKS.find(item => item.companyCodes.has(companyCode))
  if (!fallback) return results

  const excludedNifs = new Set(
    CONSOLIDATED_SUPPLIER_GROUPS.filter(group => group.companyCodes.has(companyCode)).flatMap(group => [...group.nifs]),
  )

  // O SQL do Primavera às vezes devolve a conta com espaços (campo de largura fixa) — a
  // comparação aqui é exata, ao contrário do resto do ficheiro que só usa regex/prefixo, por isso
  // precisa do trim explícito para não falhar silenciosamente.
  const isFallbackAccount = (account?: string) => (account ?? '').trim() === fallback.account

  const receiptsByMonth = new Map<string, number[]>()
  groupTransactionLines(movements).forEach(group => {
    const isLumpTransaction = group.lines.some(line => isFallbackAccount(line.account) && line.debit !== 0)
    if (!isLumpTransaction) return
    const month = monthKey(group.representative.date)
    const receipts = group.lines
      .filter(line => !isFallbackAccount(line.account))
      .map(line => cents(line.debit || line.credit))
      .filter(Boolean)
    receiptsByMonth.set(month, [...(receiptsByMonth.get(month) ?? []), ...receipts])
  })

  invoices.forEach(invoice => {
    if (excludedNifs.has(invoice.supplierNif)) return
    const available = receiptsByMonth.get(monthKey(invoice.documentDate))
    if (!available?.length) return
    const index = available.indexOf(cents(invoice.totalAmount))
    if (index === -1) return
    available.splice(index, 1) // consome a linha para não a atribuir a duas faturas iguais
    results.set(invoice.id, {
      kind: 'possible',
      lowConfidence: true,
      evidence: `${fallback.label}. Requer revisão manual antes de confirmar.`,
    })
  })

  return results
}

// O scraper do e-Fatura guarda o tipo de documento tal como vem do portal das Finanças no campo
// description ("Fatura", "Fatura-recibo", "Fatura simplificada", "Nota de crédito", "Nota de
// débito") — é a fonte fiável, não o texto do documentNo (cujo prefixo varia: "NC", "NCC" e
// provavelmente outras variantes ainda não vistas). Mantém o prefixo como reforço, para o caso de
// a description vir vazia ou genérica (ex.: upload manual sem coluna de tipo). Uma NC que anula
// uma fatura por completo tem exatamente os mesmos valores dela (só que na conta de fornecedor
// troca de lado — é débito em vez de crédito), por isso o valor sozinho não chega para os
// distinguir quando caem dentro da mesma janela de datas; é preciso também verificar o lado do
// lançamento.
export function isCreditNote(invoice: PurchaseInvoice) {
  return /nota de cr[ée]dito/i.test(invoice.description) || /^NC/i.test(invoice.documentNo.trim())
}

// Confirmado num teste real: um lançamento de estorno/anulação pode debitar E creditar a mesma
// conta de fornecedor pelo mesmo valor dentro do MESMO lançamento (anula-se a ele próprio, saldo
// líquido zero) — olhar só à primeira linha encontrada apanha esse lançamento por engano. O saldo
// líquido da conta dentro do grupo é que diz a direção real.
function netPayableBalance(group: MovementGroup): number | null {
  let net = 0
  let found = false
  group.lines.forEach(line => {
    if (!isPayableAccount(line.account)) return
    found = true
    net += line.debit - line.credit
  })
  return found ? net : null
}

function matchesExpectedPolarity(group: MovementGroup, invoiceIsCreditNote: boolean) {
  const net = netPayableBalance(group)
  if (net === null) return true
  // NC: a dívida ao fornecedor deve diminuir (líquido a débito). Fatura normal: deve aumentar
  // (líquido a crédito). Um lançamento que se anula a si mesmo (líquido 0) nunca serve para nenhum.
  return invoiceIsCreditNote ? net > 0 : net < 0
}

// matchPurchaseInLedger avalia cada fatura isoladamente, sem saber que outra fatura já reclamou o
// mesmo lançamento. Quando duas ou mais faturas do mesmo fornecedor têm exatamente o mesmo valor
// (ex.: séries lançadas no mesmo dia) e o número do documento não consegue desempatá-las, cada
// uma pode acabar "casada" com a MESMA linha contabilística de forma totalmente independente —
// confirmado com dados reais onde 3 faturas iguais apontavam para 1 único lançamento. Isto corrige
// a posteriori: nunca deixa a mesma linha confirmar/sugerir para mais do que uma fatura sem aviso.
export function resolveMovementConflicts(invoiceIds: string[], matches: Map<string, PurchaseSqlMatch>): void {
  const claimsByMovement = new Map<string, string[]>()
  invoiceIds.forEach(invoiceId => {
    const movementId = matches.get(invoiceId)?.movement?.id
    if (!movementId) return
    claimsByMovement.set(movementId, [...(claimsByMovement.get(movementId) ?? []), invoiceId])
  })
  claimsByMovement.forEach(claimants => {
    if (claimants.length < 2) return
    claimants.forEach(invoiceId => {
      const match = matches.get(invoiceId)!
      matches.set(invoiceId, {
        kind: 'possible',
        movement: match.movement,
        posting: match.posting,
        lowConfidence: true,
        evidence: `Este lançamento também bate com o valor de outra(s) ${claimants.length - 1} fatura(s) do mesmo fornecedor — não pode confirmar-se sozinho; escolhe manualmente qual corresponde.`,
      })
    })
  })
}

export function matchPurchaseInLedger(
  invoice: PurchaseInvoice,
  movements: LedgerMovement[],
  // Esta conta tem de vir da ficha de fornecedor encontrada pelo NIF — não se usa uma conta
  // preenchida manualmente para conceder a tolerância monetária.
  supplierAccountForNif?: string,
  // Código da ficha de fornecedor resolvida pelo mesmo NIF (ex.: 090084 para a NOS).
  supplierEntityCodeForNif?: string,
): PurchaseSqlMatch {
  const groups = groupTransactionLines(movements)
  const creditNote = isCreditNote(invoice)
  const allSameAmount = groups.filter(group => groupAmountMatches(group, invoice.totalAmount) && matchesExpectedPolarity(group, creditNote))
  const sameNifAmount = supplierAccountForNif || supplierEntityCodeForNif
    ? allSameAmount.filter(group =>
      Boolean(supplierAccountForNif && groupHasAccount(group, supplierAccountForNif))
      || Boolean(supplierEntityCodeForNif && groupHasSupplierEntity(group, supplierEntityCodeForNif)),
    )
    : []
  // Se a conta ligada ao NIF aparece num dos lançamentos com o valor certo, usa esse subconjunto
  // para não escolher por engano uma fatura de outro fornecedor com o mesmo total.
  const sameAmount = sameNifAmount.length ? sameNifAmount : allSameAmount

  // O código da Entidade é resolvido a partir da ficha que tem o mesmo NIF da fatura. É uma prova
  // válida tanto em lançamentos diretos no banco como em lançamentos normais de fornecedor. Este
  // segundo caso é importante quando a conta calculada a partir do template da ficha não coincide
  // literalmente com a conta usada no movimento (ex.: 22111090218 vs 2211190218), ou quando a
  // referência contabilística é apenas um número interno completamente diferente.
  const entitySupplierAmount = supplierEntityCodeForNif
    ? allSameAmount.filter(group =>
      groupHasSupplierEntity(group, supplierEntityCodeForNif),
    )
    : []
  const entityWideDate = entitySupplierAmount.filter(group => dayDistance(invoice.documentDate, group.representative.date) <= 45)
  const entityDocument = entityWideDate.filter(group => groupDocumentMatch(invoice.documentNo, group) !== 'none')
  const entitySameDate = entityWideDate.filter(group => dayDistance(invoice.documentDate, group.representative.date) === 0)
  const entityCloseDate = entityWideDate.filter(group => dayDistance(invoice.documentDate, group.representative.date) <= 7)
  const entitySameMonth = entityWideDate.filter(group => monthKey(group.representative.date) === monthKey(invoice.documentDate))
  const entityCandidates = entityDocument.length === 1 ? entityDocument
    : entitySameDate.length === 1 ? entitySameDate
      : entityCloseDate.length === 1 ? entityCloseDate
        : entitySameMonth.length === 1 ? entitySameMonth
          : entityWideDate.length === 1 ? entityWideDate
            : []
  if (entityCandidates.length === 1 && supplierEntityCodeForNif) {
    const group = entityCandidates[0]
    const entityMovement = supplierEntityMovement(group, supplierEntityCodeForNif)
    const hasDocumentSuffix = groupDocumentMatch(invoice.documentNo, group) !== 'none'
    const directBank = isDirectBankPosting(group)
    return {
      kind: 'confirmed',
      movement: entityMovement ?? group.representative,
      posting: postingOf(group),
      directBank,
      evidence: `${directBank ? 'Lançamento direto no banco' : 'Lançamento de fornecedor'} confirmado: fornecedor identificado pela Entidade ${supplierEntityCodeForNif} (mesmo NIF), valor exato e candidato único no período.${hasDocumentSuffix ? ' Os últimos dígitos do documento também coincidem.' : ' A referência completa do documento não foi exigida.'}`,
    }
  }
  if (entityWideDate.length > 1) {
    return {
      kind: 'possible',
      directBank: entityWideDate.every(isDirectBankPosting),
      evidence: `Foram encontrados vários lançamentos da Entidade ${supplierEntityCodeForNif}, com o mesmo valor, nos 45 dias próximos da fatura. Requer escolha manual.`,
    }
  }
  // Contabilistas lançam faturas com semanas de atraso face à data do documento (ex: SAF-T real
  // com uma fatura de 20/jan lançada a 1/fev). Documento + valor exatos já provam que é o mesmo
  // movimento, por isso esta janela pode ser bem mais larga do que a usada abaixo para o caso em
  // que só o valor bate (onde a data é a única prova extra e teria de ficar apertada).
  const wideDateWindow = sameAmount.filter(group => dayDistance(invoice.documentDate, group.representative.date) <= 45)
  const closeDate = sameAmount.filter(group => dayDistance(invoice.documentDate, group.representative.date) <= 7)
  const fullDocument = wideDateWindow.filter(group => groupDocumentMatch(invoice.documentNo, group) === 'full')
  const serialOnSameDate = closeDate.filter(group =>
    dayDistance(invoice.documentDate, group.representative.date) === 0 && groupDocumentMatch(invoice.documentNo, group) === 'serial',
  )

  if (fullDocument.length === 1) {
    return {
      kind: 'confirmed',
      movement: fullDocument[0].representative,
      posting: postingOf(fullDocument[0]),
      evidence: fullDocument[0].lines.length > 1
        ? 'Documento e data confirmados; várias linhas do lançamento somam exatamente o valor da fatura.'
        : 'Documento, valor, conta de fornecedor e data encontrados na contabilidade.',
    }
  }
  if (fullDocument.length > 1) {
    return { kind: 'possible', evidence: 'Existem vários movimentos com o mesmo documento e valor.' }
  }
  if (serialOnSameDate.length === 1) {
    return {
      kind: 'confirmed',
      movement: serialOnSameDate[0].representative,
      posting: postingOf(serialOnSameDate[0]),
      evidence: 'Série/número, valor, conta de fornecedor e data confirmados (formato do documento diferente no Primavera).',
    }
  }
  if (serialOnSameDate.length > 1) return { kind: 'possible', evidence: 'Existem vários movimentos com a mesma série/número e valor.' }
  if (closeDate.length === 1) {
    return {
      kind: 'possible',
      movement: closeDate[0].representative,
      posting: postingOf(closeDate[0]),
      evidence: 'Valor, conta e data coincidem, mas o número do documento não foi confirmado.',
    }
  }
  // Quando há vários lançamentos com o mesmo valor perto da data (ex.: outra compra qualquer com
  // o mesmo valor por coincidência), a data exata do documento ainda desempata na maior parte dos
  // casos — confirmado com dados reais onde só um dos candidatos batia na data exata da fatura.
  const sameDateExact = closeDate.filter(group => dayDistance(invoice.documentDate, group.representative.date) === 0)
  if (sameDateExact.length === 1) {
    return {
      kind: 'possible',
      movement: sameDateExact[0].representative,
      posting: postingOf(sameDateExact[0]),
      evidence: 'Valor, conta e data exata coincidem; havia outros lançamentos com o mesmo valor em datas próximas, mas só este bate na data exata da fatura. O número do documento não foi confirmado.',
    }
  }
  // Continua a haver mais do que um candidato depois de tentar a data exata (ex.: 3 faturas do
  // mesmo fornecedor, no mesmo dia, com o mesmo valor, e o Primavera não regista o número do
  // documento) — sem prova para escolher entre eles, isto teria caído em "missing" (por engano
  // parecendo que não foi encontrado nenhum lançamento), quando na verdade existem vários
  // candidatos válidos. Fica assinalado como ambíguo para revisão manual, nunca como confirmado.
  if (sameDateExact.length > 1) {
    return {
      kind: 'possible',
      lowConfidence: true,
      evidence: `Foram encontrados ${sameDateExact.length} lançamentos com o mesmo valor e a mesma data, sem número de documento a desempatar — requer escolha manual.`,
    }
  }
  if (closeDate.length > 1) {
    return {
      kind: 'possible',
      lowConfidence: true,
      evidence: `Foram encontrados ${closeDate.length} lançamentos com o mesmo valor nos 7 dias próximos da fatura, sem número de documento a desempatar — requer escolha manual.`,
    }
  }

  // Exceção pedida para pequenas diferenças de arredondamento: só é aplicada quando a conta do
  // lançamento é a conta da ficha de fornecedor encontrada pelo mesmo NIF. Uma diferença de 1 ou
  // 2 cêntimos nunca fica verde/confirmada automaticamente — segue para revisão com alerta laranja.
  const withinNifTolerance = supplierAccountForNif || supplierEntityCodeForNif
    ? groups
      .filter(group => (
        Boolean(supplierAccountForNif && groupHasAccount(group, supplierAccountForNif))
        || Boolean(supplierEntityCodeForNif && groupHasSupplierEntity(group, supplierEntityCodeForNif))
      ) && matchesExpectedPolarity(group, creditNote))
      .map(group => ({
        group,
        differenceCents: supplierAccountForNif && groupHasAccount(group, supplierAccountForNif)
          ? amountDifferenceForAccount(group, supplierAccountForNif, invoice.totalAmount)
          : amountDifferenceForGroup(group, invoice.totalAmount),
      }))
      .filter(candidate => candidate.differenceCents > 0 && candidate.differenceCents <= NIF_AMOUNT_TOLERANCE_CENTS)
    : []
  const tolerantWideDate = withinNifTolerance.filter(({ group }) => dayDistance(invoice.documentDate, group.representative.date) <= 45)
  const tolerantCloseDate = withinNifTolerance.filter(({ group }) => dayDistance(invoice.documentDate, group.representative.date) <= 7)
  const tolerantFullDocument = tolerantWideDate.filter(({ group }) => groupDocumentMatch(invoice.documentNo, group) === 'full')
  const tolerantSerialOnSameDate = tolerantCloseDate.filter(({ group }) =>
    dayDistance(invoice.documentDate, group.representative.date) === 0
    && groupDocumentMatch(invoice.documentNo, group) === 'serial',
  )
  const tolerantSameDate = tolerantCloseDate.filter(({ group }) => dayDistance(invoice.documentDate, group.representative.date) === 0)
  const tolerantSameMonth = tolerantWideDate.filter(({ group }) => monthKey(group.representative.date) === monthKey(invoice.documentDate))
  const tolerantCandidates = tolerantFullDocument.length === 1 ? tolerantFullDocument
    : tolerantSerialOnSameDate.length === 1 ? tolerantSerialOnSameDate
      : tolerantCloseDate.length === 1 ? tolerantCloseDate
        : tolerantSameDate.length === 1 ? tolerantSameDate
          : tolerantSameMonth.length === 1 ? tolerantSameMonth
            : tolerantWideDate.length === 1 ? tolerantWideDate
              : []
  if (tolerantCandidates.length === 1) {
    const { group, differenceCents } = tolerantCandidates[0]
    const amountDifference = differenceCents / 100
    const supplierMovement = supplierAccountForNif
      ? group.lines.find(line => sameAccount(line.account, supplierAccountForNif))
      : supplierEntityCodeForNif ? supplierEntityMovement(group, supplierEntityCodeForNif) : undefined
    const directBank = Boolean(supplierEntityCodeForNif
      && groupHasSupplierEntity(group, supplierEntityCodeForNif)
      && isDirectBankPosting(group))
    return {
      kind: 'possible',
      movement: supplierMovement ?? group.representative,
      posting: postingOf(group),
      amountDifference,
      directBank,
      evidence: `${directBank ? 'Lançamento direto no banco: entidade/NIF do fornecedor coincidem' : 'NIF/conta do fornecedor coincidem'}, mas o total no Primavera difere ${amountDifference.toFixed(2).replace('.', ',')} € do e-Fatura (dentro da tolerância de 0,02 €). Requer revisão.`,
    }
  }
  const documentOnly = groups.filter(group =>
    dayDistance(invoice.documentDate, group.representative.date) <= 90
    && groupDocumentMatch(invoice.documentNo, group) !== 'none',
  )
  if (documentOnly.length === 1) {
    return {
      kind: 'possible',
      movement: documentOnly[0].representative,
      posting: postingOf(documentOnly[0]),
      evidence: 'O documento existe na contabilidade, mas o valor lançado é diferente; requer revisão.',
    }
  }
  return { kind: 'missing', evidence: 'Não foi possível confirmar automaticamente por documento, valor e data; pode existir com outra referência.' }
}
