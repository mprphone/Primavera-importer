import { VatRegime } from '../../core/clients'
import { VatRate } from '../../core/master-data'
import { Templates } from '../../core/templates'
import { setRange, setRightAlignedFieldEndingAt, stripAccents, toAmountString } from '../../core/utils'
import { isCreditNote } from './purchase-reconciliation'
import { PurchaseInvoice, PurchaseInvoiceLine } from './types'

// Templates de linha extraídos byte a byte de um lançamento de Compras real, aceito pelo ERP Evolution
// (formato GCPLE10.03, 1424 carateres) — o formato anterior (RHPLP07.01, 301 carateres) não tem
// espaço para os campos fiscais obrigatórios (NIF, nome, país, taxa de IVA, datas do documento),
// o que causava os erros "Valor não pode ser zero" e "Classe do IVA tem wildcards" ao importar.
// Usamos uma linha real como esqueleto e só substituímos os campos que sabemos que variam — tudo o
// resto (incluindo campos ainda não totalmente decifrados) fica exatamente como no exemplo aprovado.
const LINE_WITH_ENTITY = 'NNNFC0104221110040           02   -1        VFA         168VFA - FT FA.2026/477                                        43304.00C0040        F                              1                           0NN                0  2026EUR         1.0000000         1.0000000         1.00000000N             0.0000020260401FT FA.2026/477                                                                                                                                                                                                    0.00                                                                                                                                            2026                                                                                                 202604012026040120260401502880716           Vipetrade - Comercio Internacional, Lda                                                                                                               PT                                                             23.00DEP             0.00       0.00  502880716           Vipetrade - Comercio Internacional, Lda                                                                                                               PT                                                                                                                                                                            0                N'
const LINE_WITHOUT_ENTITY = 'NNNFC010424321132311         02   -1        VFA         168VFA - FT FA.2026/477                                         8097.50D                       3111                2                           0NN                0  2026EUR         1.0000000         1.0000000         1.00000000N             0.0000020260401FT FA.2026/477                                                                                                                                                                                                    0.00                                                                                                                                            2026                                                                                                 202604012026040120260401502880716           Vipetrade - Comercio Internacional, Lda                                                                                                               PT                                                              0.00                0.00       0.00                                                                                                                                                                                                                                                                                                                                                          0                N'

// Posição da "Entidade" no lançamento: coincide exatamente com o sufixo de 4 dígitos já usado para
// construir a conta corrente (CnfTabLigCBL.Conta) — não é um dado novo a sincronizar.
function entitySuffix(account: string) {
  return account.slice(-4)
}

function expenseLinesOf(invoice: PurchaseInvoice): PurchaseInvoiceLine[] {
  if (invoice.detailLines?.length) return invoice.detailLines
  return [{ id: invoice.id, netAmount: invoice.netAmount, vatAmount: invoice.vatAmount, expenseAccount: invoice.expenseAccount, vatCode: invoice.vatCode }]
}

export type PurchasePostingPreviewLine = {
  id: string
  account: string
  kind: 'expense' | 'vat' | 'supplier' | 'payment'
  debit: number
  credit: number
}

// Espelha exatamente a lógica usada no TXT para que a janela mostre o movimento que será
// exportado. Em empresas sem direito à dedução, base + IVA ficam juntos na conta de gasto.
// Uma nota de crédito lança tudo ao contrário de uma fatura normal: reduz a dívida ao fornecedor
// (débito, não crédito) e reverte o gasto/IVA já registados (crédito, não débito) — confirmado
// num lançamento real (débito na conta de fornecedor, crédito na conta de gasto e na de IVA).
export function buildPurchasePostingPreview(
  invoice: PurchaseInvoice,
  details: PurchaseInvoiceLine[],
  vatRegime: VatRegime,
  vatRates: VatRate[],
): PurchasePostingPreviewLine[] {
  const preview: PurchasePostingPreviewLine[] = []
  const creditNote = isCreditNote(invoice)
  details.forEach((detail, index) => {
    const vatRate = vatRates.find(rate => rate.code === detail.vatCode)
    const hasDeductibleVat = vatRegime !== 'isento' && detail.vatAmount > 0.0001 && Boolean(vatRate?.account)
    const expenseAmount = hasDeductibleVat ? detail.netAmount : detail.netAmount + detail.vatAmount
    preview.push({
      id: `expense-${detail.id}-${index}`,
      account: detail.expenseAccount,
      kind: 'expense',
      debit: creditNote ? 0 : expenseAmount,
      credit: creditNote ? expenseAmount : 0,
    })
    if (hasDeductibleVat && vatRate?.account) {
      preview.push({
        id: `vat-${detail.id}-${index}`,
        account: vatRate.account,
        kind: 'vat',
        debit: creditNote ? 0 : detail.vatAmount,
        credit: creditNote ? detail.vatAmount : 0,
      })
    }
  })
  preview.push({
    id: 'supplier-purchase',
    account: invoice.supplierAccount,
    kind: 'supplier',
    debit: creditNote ? invoice.totalAmount : 0,
    credit: creditNote ? 0 : invoice.totalAmount,
  })
  if (invoice.paid && invoice.paymentAccount) {
    preview.push({
      id: 'supplier-payment',
      account: invoice.supplierAccount,
      kind: 'supplier',
      debit: creditNote ? 0 : invoice.totalAmount,
      credit: creditNote ? invoice.totalAmount : 0,
    })
    preview.push({
      id: 'payment',
      account: invoice.paymentAccount,
      kind: 'payment',
      debit: creditNote ? invoice.totalAmount : 0,
      credit: creditNote ? 0 : invoice.totalAmount,
    })
  }
  return preview
}

function buildLine(
  invoice: PurchaseInvoice,
  account: string,
  amount: number,
  dc: 'D' | 'C',
  year: number,
  journal: string,
  documentNumber: number,
  lancamentoIndex: number,
  nif: string,
  nome: string,
  taxaIva: number | null,
  entity?: { account?: string; vatCode?: string; reflexoAccount?: string; recap?: boolean; recapTerceiro?: boolean },
) {
  const fields = Templates.v_gcp.field
  const date = new Date(`${invoice.documentDate}T12:00:00`)
  const ddmm = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}`
  const docDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const description = stripAccents(`VFA - ${invoice.documentNo} ${invoice.supplierName}`.trim())
  let line = entity?.account ? LINE_WITH_ENTITY : LINE_WITHOUT_ENTITY
  line = setRange(line, fields.dateStart, fields.dateLen, ddmm)
  line = setRange(line, fields.accountStart, fields.accountLen, account)
  line = setRange(line, fields.diarioStart, fields.diarioLen, journal)
  line = setRange(line, fields.contadorStart, fields.contadorLen, `-${lancamentoIndex}`)
  line = setRightAlignedFieldEndingAt(line, fields.numDocEnd, fields.numDocLen, String(documentNumber))
  line = setRange(line, fields.descStart, fields.descLen, description)
  line = setRightAlignedFieldEndingAt(line, fields.amountEnd, fields.amountFieldLen, toAmountString(amount))
  line = line.substring(0, fields.dcPos) + dc + line.substring(fields.dcPos + 1)
  if (entity?.account) {
    line = setRange(line, fields.entidadeStart, fields.entidadeLen, entitySuffix(entity.account))
    line = setRange(line, fields.tipoEntidadeStart, fields.tipoEntidadeLen, 'F')
  }
  // O template-base (uma linha real) já trazia vatCode/reflexo/taxa preenchidos para o seu próprio
  // contexto — limpa sempre primeiro para não herdar um valor que não se aplica a esta linha.
  line = setRange(line, fields.vatCodeStart, fields.vatCodeLen, '')
  if (entity?.vatCode) line = setRange(line, fields.vatCodeStart, fields.vatCodeLen, entity.vatCode)
  line = setRange(line, fields.reflexoStart, fields.reflexoLen, '')
  if (entity?.reflexoAccount) line = setRange(line, fields.reflexoStart, fields.reflexoLen, entity.reflexoAccount)
  line = setRange(line, fields.yearStart, fields.yearLen, String(year))
  line = setRange(line, fields.docDateStart, fields.docDateLen, docDate)
  // O formato GCP repete a data fiscal em três campos junto dos dados da entidade. Se ficarem
  // com a data do lançamento usado como modelo, o ERP pode comparar datas inconsistentes.
  line = setRange(line, fields.fiscalDate1Start, fields.docDateLen, docDate)
  line = setRange(line, fields.fiscalDate2Start, fields.docDateLen, docDate)
  line = setRange(line, fields.fiscalDate3Start, fields.docDateLen, docDate)
  line = setRange(line, fields.refDocStart, fields.refDocLen, stripAccents(invoice.documentNo))
  line = setRange(line, fields.nifStart, fields.nifLen, nif)
  line = setRange(line, fields.nomeStart, fields.nomeLen, stripAccents(nome))
  line = setRange(line, fields.taxaIvaStart, fields.taxaIvaLen, '')
  if (taxaIva !== null) line = setRange(line, fields.taxaIvaStart, fields.taxaIvaLen, taxaIva.toFixed(2))
  // O template-base também replicava NIF/Nome/País em duas zonas extra (recapitulativo de entidade
  // e terceiro para reembolso de IVA) — limpa sempre primeiro, já que um pagamento ou a linha de
  // IVA não devem gerar recapitulativo (o ERP Evolution rejeitava isto: "erro de recapitulativo de
  // fornecedor" ao reaproveitar os dados do exemplo original nessas zonas).
  line = setRange(line, fields.nifRecapStart, fields.nifLen, '')
  line = setRange(line, fields.nomeRecapStart, fields.nomeLen, '')
  line = setRange(line, fields.paisRecapStart, fields.paisLen, '')
  line = setRange(line, fields.nifTerceiroStart, fields.nifLen, '')
  line = setRange(line, fields.nomeTerceiroStart, fields.nomeLen, '')
  line = setRange(line, fields.paisTerceiroStart, fields.paisLen, '')
  if (entity?.recap) {
    line = setRange(line, fields.nifRecapStart, fields.nifLen, nif)
    line = setRange(line, fields.nomeRecapStart, fields.nomeLen, stripAccents(nome))
    line = setRange(line, fields.paisRecapStart, fields.paisLen, 'PT')
  }
  if (entity?.recapTerceiro) {
    line = setRange(line, fields.nifTerceiroStart, fields.nifLen, nif)
    line = setRange(line, fields.nomeTerceiroStart, fields.nomeLen, stripAccents(nome))
    line = setRange(line, fields.paisTerceiroStart, fields.paisLen, 'PT')
  }
  return line
}

function buildMasterLine(
  invoice: PurchaseInvoice,
  year: number,
  journal: string,
  documentNumber: number,
  lancamentoIndex: number,
  nif: string,
  nome: string,
  taxaIva: number | null,
  dc: 'D' | 'C',
) {
  const fields = Templates.v_gcp.field
  // Parte da linha de fornecedor aprovada, aplicando depois os campos específicos da linha
  // mestre (M). Esta linha cria o cabeçalho do lançamento e impede que o ERP reutilize a data
  // que estava ativa no ecrã no momento da importação.
  let line = buildLine(
    invoice,
    '',
    invoice.totalAmount,
    dc,
    year,
    journal,
    documentNumber,
    lancamentoIndex,
    nif,
    nome,
    taxaIva,
    { account: invoice.supplierAccount, recap: true },
  )
  line = line.substring(0, 3) + 'M' + line.substring(4)
  line = setRange(line, fields.accountStart, fields.accountLen, '')
  line = setRange(line, fields.descStart, fields.descLen, `VFA ${year}/${documentNumber}`)
  line = setRange(line, fields.masterYearStart, fields.masterYearLen, String(year))
  line = setRange(line, fields.masterDocumentStart, fields.masterDocumentLen, `VFA ${year}/${documentNumber}`)
  line = setRange(line, fields.masterSequenceStart, fields.masterSequenceLen, '0001')
  line = setRightAlignedFieldEndingAt(line, fields.masterAmount1End, fields.masterAmountLen, toAmountString(invoice.totalAmount))
  line = setRightAlignedFieldEndingAt(line, fields.masterAmount2End, fields.masterAmountLen, toAmountString(invoice.totalAmount))
  line = setRightAlignedFieldEndingAt(line, fields.masterAmount3End, fields.masterAmountLen, toAmountString(invoice.totalAmount))
  line = setRange(line, fields.masterCurrencyStart, fields.masterCurrencyLen, 'EUR')
  line = line.substring(0, fields.masterDcPos) + dc + line.substring(fields.masterDcPos + 1)
  return line
}

// Quem prepara o TXT confere as faturas por uma certa ordem antes de exportar; lançar pela mesma
// ordem em que foram conferidas deixa a capa impressa organizada com os lançamentos. Faturas sem
// marca de conferência mantêm a posição relativa que já tinham (sort estável), para nunca baralhar
// quem ainda não foi marcado.
function orderedForExport(invoices: PurchaseInvoice[]): PurchaseInvoice[] {
  return [...invoices].sort((a, b) => {
    if (a.reviewedAt && b.reviewedAt) return a.reviewedAt < b.reviewedAt ? -1 : a.reviewedAt > b.reviewedAt ? 1 : 0
    if (a.reviewedAt) return -1
    if (b.reviewedAt) return 1
    return 0
  })
}

export function generatePurchasesTxt(invoices: PurchaseInvoice[], year: number, startNumber: number, vatRegime: VatRegime, vatRates: VatRate[]) {
  const headers = `${Templates.v_gcp.headers.join('\n')}\n\n`
  const lines: string[] = []
  orderedForExport(invoices).forEach((invoice, index) => {
    const number = startNumber + index
    const lancamentoIndex = index + 1
    const isento = vatRegime === 'isento'
    const nif = invoice.supplierNif || ''
    const nome = invoice.supplierName || ''
    // Uma nota de crédito lança tudo ao contrário de uma fatura normal: reduz a dívida ao
    // fornecedor (débito) e reverte o gasto/IVA já registados (crédito) — confirmado num
    // lançamento real da contabilidade.
    const creditNote = isCreditNote(invoice)
    const masterVatRate = expenseLinesOf(invoice)
      .map(detail => vatRates.find(rate => rate.code === detail.vatCode)?.rate)
      .find((rate): rate is number => typeof rate === 'number') ?? null
    lines.push(buildMasterLine(
      invoice,
      year,
      invoice.journal,
      number,
      lancamentoIndex,
      nif,
      nome,
      masterVatRate,
      creditNote ? 'D' : 'C',
    ))
    lines.push(buildLine(
      invoice, invoice.supplierAccount, invoice.totalAmount, creditNote ? 'D' : 'C', year, invoice.journal, number, lancamentoIndex, nif, nome, null,
      { account: invoice.supplierAccount, recap: true },
    ))
    // Faturas com mais do que uma conta de gasto/taxa de IVA (detailLines) geram uma linha de
    // despesa (+ IVA, se dedutível) por cada item, dentro do mesmo lançamento da fatura.
    expenseLinesOf(invoice).forEach(detail => {
      const vatRate = vatRates.find(rate => rate.code === detail.vatCode)
      const hasDeductibleVat = !isento && detail.vatAmount > 0.0001 && !!vatRate?.account
      const expenseAmount = hasDeductibleVat ? detail.netAmount : detail.netAmount + detail.vatAmount
      // O código de IVA da operação vai sempre na linha de despesa (reporte fiscal, Anexo L
      // incluído), mas só existe uma linha extra (conta de IVA dedutível) quando esse código tiver
      // conta associada — IVA não dedutível (ex: Art.21º) fica embutido no valor da despesa.
      lines.push(buildLine(
        invoice, detail.expenseAccount, expenseAmount, creditNote ? 'C' : 'D', year, invoice.journal, number, lancamentoIndex, nif, nome, vatRate?.rate ?? null,
        { account: invoice.supplierAccount, vatCode: detail.vatCode, recap: true, recapTerceiro: true },
      ))
      if (hasDeductibleVat && vatRate) {
        // A linha de IVA traz um "reflexo" com a conta de despesa associada — sem isto, o
        // ERP Evolution não consegue ligar o IVA à despesa correspondente.
        lines.push(buildLine(
          invoice, vatRate.account!, detail.vatAmount, creditNote ? 'C' : 'D', year, invoice.journal, number, lancamentoIndex, nif, nome, null,
          { reflexoAccount: detail.expenseAccount },
        ))
      }
    })
    // O pagamento entra no mesmo lançamento da compra (mesmo número/lançamento): debita o
    // fornecedor (quita a dívida) e credita a conta de banco/caixa escolhida.
    if (invoice.paid && invoice.paymentAccount) {
      lines.push(buildLine(
        invoice, invoice.supplierAccount, invoice.totalAmount, creditNote ? 'C' : 'D', year, invoice.journal, number, lancamentoIndex, nif, nome, null,
        { account: invoice.supplierAccount },
      ))
      lines.push(buildLine(
        invoice, invoice.paymentAccount, invoice.totalAmount, creditNote ? 'D' : 'C', year, invoice.journal, number, lancamentoIndex, nif, nome, null,
      ))
    }
  })
  return headers + lines.join('\n') + '\n'
}

function trimmed(value: string | undefined | null) {
  return (value ?? '').trim()
}

function expenseLinesReady(invoice: PurchaseInvoice, isento: boolean): boolean {
  return expenseLinesOf(invoice).every(line =>
    trimmed(line.expenseAccount) && (isento || line.vatAmount <= 0.0001 || trimmed(line.vatCode))
  )
}

export function isInvoiceReadyForExport(invoice: PurchaseInvoice, vatRegime: VatRegime): boolean {
  const isento = vatRegime === 'isento'
  if (Math.abs(invoice.netAmount + invoice.vatAmount - invoice.totalAmount) >= 0.02) return false
  if (!trimmed(invoice.supplierAccount) || !trimmed(invoice.journal)) return false
  if (!expenseLinesReady(invoice, isento)) return false
  if (invoice.paid && !trimmed(invoice.paymentAccount)) return false
  return true
}

export function validatePurchasesForExport(invoices: PurchaseInvoice[], vatRegime: VatRegime) {
  if (!invoices.length) return 'Seleciona pelo menos uma fatura.'
  const unbalanced = invoices.find(invoice => Math.abs(invoice.netAmount + invoice.vatAmount - invoice.totalAmount) >= 0.02)
  if (unbalanced) return `A fatura ${unbalanced.documentNo} não fecha: base + IVA é diferente do total.`
  const isento = vatRegime === 'isento'
  const invalid = invoices.find(invoice =>
    !trimmed(invoice.supplierAccount) ||
    !trimmed(invoice.journal) ||
    !expenseLinesReady(invoice, isento)
  )
  if (invalid) return `Completa as contas e o diário da fatura ${invalid.documentNo}.`
  const unpaidAccount = invoices.find(invoice => invoice.paid && !trimmed(invoice.paymentAccount))
  if (unpaidAccount) return `Indica a conta de pagamento (banco/caixa) da fatura ${unpaidAccount.documentNo}.`
  return ''
}
