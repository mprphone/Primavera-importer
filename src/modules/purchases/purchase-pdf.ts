import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { PurchaseInvoice } from './types'

const euro = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}/${month}/${year}` : iso
}

function formatMoney(value: number) {
  return `${euro.format(value)}\u00a0€`
}

// Lista as faturas que o e-Fatura mostra existirem mas que a verificação ao Primavera não
// conseguiu confirmar — são estas que faltam pedir ao cliente (documento, ou confirmação de que
// já foi lançada com outra referência).
export function exportUnconfirmedInvoicesPdf(invoices: PurchaseInvoice[], clientName: string, month = '') {
  const pending = invoices
    .filter(invoice =>
      invoice.sqlVerification?.status === 'missing'
      && (!month || invoice.documentDate.startsWith(month)),
    )
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'pt') || a.documentDate.localeCompare(b.documentDate))

  const doc = new jsPDF()
  const generatedAt = new Date().toLocaleDateString('pt-PT')
  const period = month ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : 'todos os meses'

  doc.setFontSize(12)
  doc.text('Faturas por confirmar', 14, 14)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(clientName, 14, 19)
  doc.text(`Período: ${period} · Gerado em ${generatedAt} · ${pending.length} documento(s)`, 14, 23.5)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 27,
    head: [['Data', 'Documento', 'Fornecedor', 'NIF', 'IVA', 'Total']],
    body: pending.map(invoice => [
      formatDate(invoice.documentDate),
      invoice.documentNo,
      invoice.supplierName || 'Fornecedor por identificar',
      invoice.supplierNif || '—',
      formatMoney(invoice.vatAmount),
      formatMoney(invoice.totalAmount),
    ]),
    styles: { fontSize: 6.5, cellPadding: { top: 1, right: 2, bottom: 1, left: 2 }, lineWidth: 0.1 },
    headStyles: { fillColor: [47, 104, 65], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 49 },
      2: { cellWidth: 54 },
      3: { cellWidth: 21, halign: 'center' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
  })

  const periodSuffix = month ? `-${month}` : ''
  doc.save(`faturas-por-confirmar${periodSuffix}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
