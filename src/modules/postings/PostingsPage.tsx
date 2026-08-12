import React, { useEffect, useMemo, useState } from 'react'
import { PrimaveraMasterData } from '../../core/master-data'
import { normalizeForMatch } from '../../core/utils'
import { monthRange } from '../banking/BankingPage'
import { loadBankingState, refreshBankingStateFromServer } from '../banking/bank-storage'
import { BankMovement } from '../banking/types'
import { downloadPostingsTxt } from './download'
import { PostingRow } from './PostingRow'
import {
  loadDescriptionModels,
  loadPostingDrafts,
  refreshDescriptionModelsFromServer,
  refreshPostingDraftsFromServer,
  rememberDescriptionModel,
  saveDescriptionModels,
  savePostingDrafts,
  suggestFromModels,
} from './postings-storage'
import { generatePostingsTxt, PostingEntry, validatePostingsForExport } from './postings-txt'
import { DescriptionPostingModel, PostingDraft } from './types'
import './postings.css'
import { learnSmartRule, seedSmartRule, suggestSmartRule } from '../../core/smart-rules'

type Props = {
  clientId: string
  account: string
  month: string
  year: number
  startNumber: number
  defaultJournal: string
  defaultDocument: string
  onDefaultJournalChange: (value: string) => void
  onDefaultDocumentChange: (value: string) => void
  masterData: PrimaveraMasterData
}

function emptyDraft(movementId: string, defaultJournal: string, defaultDocument: string): PostingDraft {
  return { movementId, counterAccount: '', journal: defaultJournal, documentType: defaultDocument, status: 'pending' }
}

export function PostingsPage({
  clientId, account, month, year, startNumber, defaultJournal, defaultDocument,
  onDefaultJournalChange, onDefaultDocumentChange, masterData,
}: Props) {
  const [bankMovements, setBankMovements] = useState<BankMovement[]>(() => loadBankingState(clientId).movements)
  const [drafts, setDrafts] = useState<Record<string, PostingDraft>>(() => loadPostingDrafts(clientId))
  const [models, setModels] = useState<Record<string, DescriptionPostingModel>>(() => loadDescriptionModels(clientId))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [showExported, setShowExported] = useState(false)
  const [descriptionFilter, setDescriptionFilter] = useState('')
  const [bulkAccount, setBulkAccount] = useState('')

  useEffect(() => {
    let cancelled = false
    refreshBankingStateFromServer(clientId).then(remote => { if (!cancelled && remote) setBankMovements(remote.movements) })
    refreshPostingDraftsFromServer(clientId).then(remote => { if (!cancelled && remote) setDrafts(remote) })
    refreshDescriptionModelsFromServer(clientId).then(remote => { if (!cancelled && remote) setModels(remote) })
    return () => { cancelled = true }
  }, [clientId])

  useEffect(() => {
    Object.values(models).forEach(model => seedSmartRule(clientId, 'posting', model.key, {
      counterAccount: model.counterAccount, journal: model.journal, documentType: model.documentType,
    }))
  }, [clientId, models])

  const { dateTo: periodTo } = useMemo(() => monthRange(month), [month])

  // Tal como na reconciliação: um movimento de um mês anterior que ainda não foi lançado
  // continua a precisar de lançamento, por isso não desaparece só por se ter mudado de mês.
  const pendingBankMovements = useMemo(
    () => bankMovements.filter(item =>
      item.source === 'bank' && item.status === 'pending' && item.account === account && item.date <= periodTo
    ),
    [bankMovements, account, periodTo],
  )

  const entries: PostingEntry[] = useMemo(() => pendingBankMovements.map(movement => {
    const existing = drafts[movement.id]
    if (existing) return { movement, draft: existing }
    const legacy = suggestFromModels(movement.description, models)
    const smart = suggestSmartRule(clientId, 'posting', `${movement.description} ${movement.reference}`)
    const suggestion = smart ? {
      counterAccount: smart.outcome.counterAccount || legacy.counterAccount || '',
      journal: smart.outcome.journal || legacy.journal || '',
      documentType: smart.outcome.documentType || legacy.documentType || '',
      intelligence: { confidence: smart.confidence, evidence: smart.evidence },
    } : legacy
    const base = emptyDraft(movement.id, defaultJournal, defaultDocument)
    return { movement, draft: { ...base, ...suggestion } }
  }), [pendingBankMovements, drafts, models, defaultJournal, defaultDocument, clientId])

  const filterTerm = normalizeForMatch(descriptionFilter)
  const visibleEntries = entries.filter(entry =>
    (showExported || entry.draft.status !== 'exported')
    && (!filterTerm || normalizeForMatch(entry.movement.description).includes(filterTerm))
  )
  const visiblePendingEntries = visibleEntries.filter(entry => entry.draft.status === 'pending')
  const selectedEntries = entries.filter(entry => selected.has(entry.movement.id) && entry.draft.status === 'pending')

  const persistDrafts = (next: Record<string, PostingDraft>) => {
    setDrafts(next)
    if (!savePostingDrafts(clientId, next)) setMessage('Sem espaço para guardar os lançamentos neste navegador.')
  }

  // Os lançamentos sem draft persistido já recebem o valor por defeito ao serem construídos
  // (ver "entries" acima). Isto cobre os que já foram gravados antes de mudar o defeito.
  useEffect(() => {
    if (!defaultJournal && !defaultDocument) return
    const needsFill = Object.values(drafts).some(draft =>
      (defaultJournal && !draft.journal.trim()) || (defaultDocument && !draft.documentType.trim())
    )
    if (!needsFill) return
    persistDrafts(Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, {
      ...draft,
      journal: draft.journal.trim() || defaultJournal,
      documentType: draft.documentType.trim() || defaultDocument,
    }])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultJournal, defaultDocument])

  const applyDefaultJournal = (value: string) => {
    onDefaultJournalChange(value)
    persistDrafts(Object.fromEntries(Object.entries(drafts).map(([id, draft]) =>
      [id, (!draft.journal.trim() || draft.journal === defaultJournal) ? { ...draft, journal: value } : draft]
    )))
  }

  const applyDefaultDocument = (value: string) => {
    onDefaultDocumentChange(value)
    persistDrafts(Object.fromEntries(Object.entries(drafts).map(([id, draft]) =>
      [id, (!draft.documentType.trim() || draft.documentType === defaultDocument) ? { ...draft, documentType: value } : draft]
    )))
  }

  const toggleSelect = (movementId: string) => {
    setSelected(current => {
      const next = new Set(current)
      next.has(movementId) ? next.delete(movementId) : next.add(movementId)
      return next
    })
  }

  const updateDraft = (next: PostingDraft, remember: boolean) => {
    persistDrafts({ ...drafts, [next.movementId]: next })
    if (!remember) return
    const entry = entries.find(item => item.movement.id === next.movementId)
    if (!entry) return
    learnSmartRule(clientId, 'posting', `${entry.movement.description} ${entry.movement.reference}`, {
      counterAccount: next.counterAccount, journal: next.journal, documentType: next.documentType,
    })
    const nextModels = rememberDescriptionModel(entry.movement.description, next, models)
    setModels(nextModels)
    saveDescriptionModels(clientId, nextModels)
  }

  const applyBulkAccount = () => {
    if (!bulkAccount.trim()) return setMessage('Escreve a conta a aplicar.')
    if (!visiblePendingEntries.length) return setMessage('Sem movimentos pendentes a aplicar.')
    const nextDrafts = { ...drafts }
    let nextModels = models
    visiblePendingEntries.forEach(entry => {
      const nextDraft: PostingDraft = { ...entry.draft, counterAccount: bulkAccount.trim() }
      nextDrafts[entry.movement.id] = nextDraft
      nextModels = rememberDescriptionModel(entry.movement.description, nextDraft, nextModels)
    })
    persistDrafts(nextDrafts)
    setModels(nextModels)
    saveDescriptionModels(clientId, nextModels)
    setMessage(`Conta ${bulkAccount.trim()} aplicada a ${visiblePendingEntries.length} movimentos.`)
  }

  const exportSelected = () => {
    const error = validatePostingsForExport(selectedEntries)
    if (error) return setMessage(error)
    const content = generatePostingsTxt(selectedEntries, year, startNumber)
    downloadPostingsTxt(`lancamentos_banco_${clientId}_${year}.txt`, content)
    const exportedAt = new Date().toISOString()
    const next = { ...drafts }
    selectedEntries.forEach(entry => {
      next[entry.movement.id] = { ...entry.draft, status: 'exported', exportedAt }
    })
    persistDrafts(next)
    setSelected(new Set())
    setMessage(`${selectedEntries.length} movimentos exportados e marcados como lançados.`)
  }

  if (!account) return <p className="muted">Seleciona primeiro uma conta 12.</p>

  return (
    <section className="postings-page">
      <div className="action-row postings-toolbar">
        <label>Diário<input list="posting-journals" value={defaultJournal} onChange={event => applyDefaultJournal(event.target.value)} /></label>
        <label>Documento<input list="posting-documents" value={defaultDocument} onChange={event => applyDefaultDocument(event.target.value)} /></label>
        <span className="postings-stats-inline">
          <b>{entries.filter(item => item.draft.status === 'pending').length}</b> pendentes ·{' '}
          <b>{entries.filter(item => item.draft.status === 'exported').length}</b> lançados ·{' '}
          <b>{selectedEntries.length}</b> selecionados
        </span>
        <input
          className="postings-filter"
          value={descriptionFilter}
          onChange={event => setDescriptionFilter(event.target.value)}
          placeholder="Filtrar por descrição (ex: depósito)"
        />
      </div>

      <div className="action-row postings-actions">
        <button onClick={exportSelected} disabled={!selectedEntries.length}>Criar TXT e marcar lançados</button>
        <button
          className="secondary"
          onClick={() => setSelected(new Set(entries.filter(item => item.draft.status === 'pending').map(item => item.movement.id)))}
        >
          Selecionar pendentes
        </button>
        <label className="inline-check"><input type="checkbox" checked={showExported} onChange={event => setShowExported(event.target.checked)} /> Mostrar lançados</label>
      </div>

      <div className="action-row postings-bulk">
        <label className="postings-bulk-inline">Aplicar conta aos filtrados
          <input list="posting-accounts" value={bulkAccount} onChange={event => setBulkAccount(event.target.value)} placeholder="Conta" />
        </label>
        <button onClick={applyBulkAccount} disabled={!bulkAccount.trim() || !visiblePendingEntries.length}>
          Aplicar a {visiblePendingEntries.length} pendentes
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className="table-wrap posting-table-wrap">
        <table className="posting-table">
          <thead>
            <tr>
              <th></th><th>Data</th><th>Descrição</th><th>Valor</th>
              <th>Conta contrapartida</th><th>Diário</th><th>Tipo doc.</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map(entry => (
              <PostingRow
                key={entry.movement.id}
                entry={entry}
                selected={selected.has(entry.movement.id)}
                onToggleSelect={toggleSelect}
                onChange={updateDraft}
              />
            ))}
            {!visibleEntries.length && (
              <tr><td colSpan={8} className="empty-state">Sem movimentos do banco por lançar nesta conta/mês.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <datalist id="posting-accounts">{masterData.accounts.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="posting-journals">{masterData.journals.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="posting-documents">{masterData.documents.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
    </section>
  )
}
