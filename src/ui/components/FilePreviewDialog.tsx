import React from 'react'
import { FileAnalysis } from '../../core/file-intelligence'

type Props = { analysis: FileAnalysis; canConfirm?: boolean; onCancel: () => void; onConfirm: () => void }

export function FilePreviewDialog({ analysis, canConfirm = true, onCancel, onConfirm }: Props) {
  return (
    <div className="module-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="module-modal file-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
        <button className="module-modal-close" onClick={onCancel} aria-label="Fechar pré-visualização">×</button>
        <span className="eyebrow">Deteção inteligente</span><h2 id="file-preview-title">Confirmar importação</h2>
        <div className="file-detection-summary">
          <span><b>Tipo</b>{analysis.kind} · {analysis.kindConfidence}%</span><span><b>Banco</b>{analysis.bankName}</span>
          <span><b>Formato</b>{analysis.amountFormat === 'debit_credit' ? 'Débito/Crédito' : 'Valor com sinal'}</span><span><b>Data</b>{analysis.dateFormat}</span><span><b>Separador</b>{analysis.separator}</span>
        </div>
        {analysis.warnings.length > 0 && <div className="exception-warning">{analysis.warnings.join(' · ')}</div>}
        <div className="table-wrap"><table><thead><tr>{Object.keys(analysis.sample[0] ?? {}).map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{analysis.sample.map((row, index) => <tr key={`${analysis.fileName}-${index}`}>{Object.keys(row).map(header => <td key={header}>{row[header]}</td>)}</tr>)}</tbody></table></div>
        <div className="purchase-detail-actions"><button className="ghost" onClick={onCancel}>Cancelar</button><button onClick={onConfirm} disabled={analysis.kind === 'unknown' || !canConfirm}>Aceitar importação</button></div>
      </section>
    </div>
  )
}
