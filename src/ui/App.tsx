import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { getClientProfile } from '../core/clients'
import { ClientSettings, loadClientSettings, refreshClientSettingsFromServer, saveClientSettings } from '../core/client-settings'
import { buildPostingPreview, generateTxt } from '../core/generator'
import { Entity, loadLocalEntities, refreshLocalEntitiesFromServer, saveLocalEntities, suggestEntity } from '../core/entities'
import { PrimaveraGatewayConnector } from '../core/primavera'
import { emptyMasterData, loadMasterData, PrimaveraMasterData, refreshMasterDataFromServer, saveMasterData } from '../core/master-data'
import { PurchasesPage } from '../modules/purchases/PurchasesPage'
import { ControlPage } from '../modules/control/ControlPage'
import { BankingSection } from '../modules/banking/BankingSection'
import { ImportWorkspace } from '../modules/importer/ImportWorkspace'
import { ParsedRow } from '../modules/importer/types'
import { AppTab, AppTabs } from './components/AppTabs'
import { ClientSelector } from './components/ClientSelector'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { MonthlyAutomationPage } from '../modules/automation/MonthlyAutomationPage'
import { useFeedback } from './feedback/FeedbackCenter'
import { ExceptionCenter } from '../modules/exceptions/ExceptionCenter'
import { seedSmartRule, suggestSmartRule } from '../core/smart-rules'
import { PwaInstallButton } from './components/PwaInstallButton'

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=windows-1252' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function tryParseDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return new Date(d.y, d.m - 1, d.d)
  }
  if (typeof v === 'string') {
    const s = v.trim()
    const m1 = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
    if (m1) return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]))
    const m2 = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
    if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]))
  }
  return null
}

function App() {
  const { notify } = useFeedback()
  const [clientId, setClientId] = useState<string | null>(null)
  const client = clientId ? getClientProfile(clientId) : undefined
  const [modelId, setModelId] = useState('')
  const model = client?.models.find(item => item.id === modelId) ?? client?.models[0]

  const [ano, setAno] = useState(() => new Date().getFullYear())
  const [diario, setDiario] = useState('')
  const [documento, setDocumento] = useState('')
  const [startNumDiario, setStartNumDiario] = useState(1)
  const [settings, setSettings] = useState<ClientSettings | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [entityPaste, setEntityPaste] = useState('')
  const [activeTab, setActiveTab] = useState<AppTab>('import')
  const [message, setMessage] = useState('')
  const [financasPassword, setFinancasPassword] = useState('')
  const [masterData, setMasterData] = useState<PrimaveraMasterData>(emptyMasterData)
  const [busyAction, setBusyAction] = useState<'test' | 'credentials' | 'sync' | 'entities' | ''>('')
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!message) return
    const error = /erro|falh|inválid|não foi|sem espaço|define|preenche/i.test(message)
    notify({ kind: error ? 'error' : 'success', title: error ? 'Atenção necessária' : 'Operação concluída', detail: message })
  }, [message, notify])

  const modelSettings = model && settings
    ? settings.models[model.id] ?? { creditAccount: '', debitAccount: '' }
    : { creditAccount: '', debitAccount: '' }

  const generationOptions = useMemo(() => ({
    ano,
    diario,
    documento,
    startNumDiario,
    creditAccount: modelSettings.creditAccount,
    debitAccount: modelSettings.debitAccount,
  }), [ano, diario, documento, startNumDiario, modelSettings.creditAccount, modelSettings.debitAccount])

  const totals = useMemo(
    () => rows.reduce((total, row) => total + Math.abs(row.amount || 0), 0),
    [rows],
  )
  const postingPreview = useMemo(
    () => model ? buildPostingPreview(model, rows, generationOptions) : [],
    [model, rows, generationOptions],
  )

  useEffect(() => {
    if (!client) return
    const saved = loadClientSettings(client)
    setModelId(client.models.some(item => item.id === saved.selectedModelId) ? saved.selectedModelId : client.models[0].id)
    setDiario(saved.diario)
    setDocumento(saved.documento)
    setStartNumDiario(saved.startNumDiario)
    setSettings(saved)
    setEntities(loadLocalEntities(client.id))
    setMasterData(loadMasterData(client.id))
    setRows([])
    setActiveTab('import')
    setFinancasPassword('')
    setMessage('')
  }, [clientId])

  useEffect(() => {
    if (!clientId) return
    entities.forEach(entity => seedSmartRule(clientId, 'posting', `${entity.name} ${entity.keywords ?? ''} ${entity.nif ?? ''}`, {
      entityCode: entity.code, entityAccount: entity.account ?? '', entityNif: entity.nif ?? '',
    }))
  }, [clientId, entities])

  useEffect(() => {
    if (!client) return
    let cancelled = false
    refreshClientSettingsFromServer(client).then(remote => {
      if (cancelled || !remote) return
      setSettings(remote)
      setModelId(client.models.some(item => item.id === remote.selectedModelId) ? remote.selectedModelId : client.models[0].id)
      setDiario(remote.diario)
      setDocumento(remote.documento)
      setStartNumDiario(remote.startNumDiario)
    })
    refreshLocalEntitiesFromServer(client.id).then(remote => {
      if (!cancelled && remote) setEntities(remote)
    })
    refreshMasterDataFromServer(client.id).then(remote => {
      if (!cancelled && remote) setMasterData(remote)
    })
    return () => { cancelled = true }
  }, [clientId])

  if (!client || !settings || !model) {
    return <ClientSelector onSelect={setClientId} />
  }

  const updateSettings = (next: ClientSettings) => {
    setSettings(next)
    saveClientSettings(client.id, next)
  }

  const updateModelSettings = (field: 'creditAccount' | 'debitAccount', value: string) => {
    updateSettings({
      ...settings,
      models: {
        ...settings.models,
        [model.id]: {
          ...modelSettings,
          [field]: value,
        },
      },
    })
  }

  const onExcel = async (file: File) => {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const out: ParsedRow[] = []

    for (const row of json) {
      const keys = Object.keys(row)
      const get = (name: string) => {
        const key = keys.find(item => item.trim().toLowerCase() === name.toLowerCase())
        return key ? row[key] : ''
      }
      const date = tryParseDate(get('Data') || get('Data da operação') || get('Data da operacao'))
      const description = String(get('Descrição') || get('Descricao') || get('Descrição da Conta') || get('Descricao da Conta') || '').trim()
      const rawAmount = get('Montante') || get('Valor') || get('Importe') || get('Total')
      const amount = typeof rawAmount === 'number'
        ? rawAmount
        : Number(String(rawAmount).replace(/\./g, '').replace(',', '.'))
      if (!date || !description || !isFinite(amount)) continue

      const suggestion = suggestEntity(description, entities)
      const smart = suggestSmartRule(client.id, 'posting', description)
      const smartEntity = smart?.outcome.entityCode ? {
        type: 'supplier' as const, code: smart.outcome.entityCode, name: smart.outcome.entityCode,
        account: smart.outcome.entityAccount, nif: smart.outcome.entityNif,
      } : undefined
      out.push({
        date,
        description,
        amount,
        suggested: suggestion.entity ?? smartEntity,
        suggestedScore: suggestion.entity ? suggestion.score : smart?.confidence,
      })
    }
    setRows(out)
    setMessage(out.length ? `${out.length} linhas importadas.` : 'Não foram encontradas linhas válidas no ficheiro.')
  }

  const parseEntitiesFromPaste = () => {
    const lines = entityPaste.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const parsed: Entity[] = []
    for (const line of lines) {
      const parts = line.split(/\t|;/).map(part => part.trim())
      if (parts.length < 3) continue
      parsed.push({
        type: parts[0].toLowerCase().includes('c') ? 'customer' : 'supplier',
        code: parts[1],
        name: parts[2],
        nif: parts[3] || undefined,
        keywords: parts[4] || undefined,
      })
    }
    const merged = [...entities, ...parsed]
    setEntities(merged)
    saveLocalEntities(client.id, merged)
    setEntityPaste('')
  }

  const validateExport = () => {
    if (!diario.trim() || !documento.trim()) return 'Preenche o diário e o documento.'
    if (!modelSettings.creditAccount.trim() || !modelSettings.debitAccount.trim()) return 'Preenche as contas de crédito e débito.'
    if (!rows.length) return 'Importa primeiro um ficheiro Excel.'
    return ''
  }

  const exportTxt = () => {
    const error = validateExport()
    if (error) {
      setMessage(error)
      return
    }
    const txt = generateTxt(model, rows, generationOptions)
    downloadText(`erp_evolution_${client.id}_${model.id}_${ano}_${diario}_${documento}.txt`, txt)
    setMessage('TXT exportado com sucesso.')
  }

  const requirePrimaveraConfiguration = () => {
    if (!settings.gatewayUrl.trim()) return 'Define o endereço do gateway local.'
    if (!settings.primaveraCompanyCode.trim()) return 'Define o código da empresa no ERP Evolution.'
    if (!settings.sqlServer.trim()) return 'Define o servidor SQL.'
    if (!settings.sqlDatabase.trim()) return 'Define a base de dados da empresa.'
    if (!settings.extensionToken.trim()) return 'Define o token da extensão (gera um novo ou cola o de outra empresa no mesmo SQL Server).'
    return ''
  }

  const testPrimaveraConnection = async () => {
    const error = requirePrimaveraConfiguration()
    if (error) return setMessage(error)
    setBusyAction('test')
    setMessage('A testar a ligação SQL em modo de leitura…')
    const result = await new PrimaveraGatewayConnector(settings.gatewayUrl)
      .testConnection(settings.primaveraCompanyCode, {
        server: settings.sqlServer,
        database: settings.sqlDatabase,
        year: ano,
        user: settings.sqlUser,
        password: settings.sqlPassword,
      }, settings.extensionToken)
    setMessage(result.message)
    setBusyAction('')
  }

  const saveFinancasCredentials = async () => {
    if (!settings.gatewayUrl.trim()) return setMessage('Define o endereço da API ERP Evolution.')
    if (!settings.primaveraCompanyCode.trim()) return setMessage('Define o código da empresa no ERP Evolution.')
    if (!settings.financasUser.trim() || !financasPassword) {
      return setMessage('Preenche o utilizador e a palavra-passe das Finanças.')
    }
    setBusyAction('credentials')
    setMessage('A guardar as credenciais na API segura…')
    const result = await new PrimaveraGatewayConnector(settings.gatewayUrl)
      .saveFinancasCredentials(settings.primaveraCompanyCode, settings.financasUser, financasPassword)
    if (result.success) setFinancasPassword('')
    setMessage(result.message)
    setBusyAction('')
  }

  const syncPrimaveraMasterData = async () => {
    const error = requirePrimaveraConfiguration()
    if (error) return setMessage(error)
    setBusyAction('sync')
    setMessage('A sincronizar plano de contas, clientes, fornecedores e IVA…')
    const result = await new PrimaveraGatewayConnector(settings.gatewayUrl)
      .syncMasterData(settings.primaveraCompanyCode, {
        server: settings.sqlServer,
        database: settings.sqlDatabase,
        year: ano,
        user: settings.sqlUser,
        password: settings.sqlPassword,
      }, settings.extensionToken)
    if (result.success && result.data) {
      const data: PrimaveraMasterData = {
        ...emptyMasterData(),
        ...masterData,
        ...result.data,
        customers: result.data.customers?.length ? result.data.customers : masterData.customers,
        suppliers: result.data.suppliers?.length ? result.data.suppliers : masterData.suppliers,
        syncedAt: result.data.syncedAt || new Date().toISOString(),
      }
      setMasterData(data)
      const masterDataSaved = saveMasterData(client.id, data)
      const syncedEntities = [...data.customers, ...data.suppliers]
      setEntities(syncedEntities)
      const entitiesSaved = saveLocalEntities(client.id, syncedEntities)
      if (!masterDataSaved || !entitiesSaved) {
        setMessage('Dados sincronizados, mas são demasiado grandes para guardar neste navegador. Continuam disponíveis até fechar a página.')
        setBusyAction('')
        return
      }
    }
    setMessage(result.message)
    setBusyAction('')
  }

  const syncPrimaveraEntities = async () => {
    const error = requirePrimaveraConfiguration()
    if (error) return setMessage(error)
    setBusyAction('entities')
    const connector = new PrimaveraGatewayConnector(settings.gatewayUrl)
    const sql = {
      server: settings.sqlServer,
      database: settings.sqlDatabase,
      year: ano,
      user: settings.sqlUser,
      password: settings.sqlPassword,
    }

    try {
      const synced: Entity[] = []
      for (const entityType of ['customer', 'supplier'] as const) {
        let offset = 0
        let hasMore = true
        while (hasMore) {
          setMessage(`A sincronizar ${entityType === 'customer' ? 'clientes' : 'fornecedores'}: ${offset} registos…`)
          const result = await connector.syncEntities(settings.primaveraCompanyCode, sql, entityType, offset, settings.extensionToken)
          if (!result.success || !result.data) {
            setMessage(result.message)
            setBusyAction('')
            return
          }
          const items = Array.isArray(result.data.items)
            ? result.data.items
            : result.data.items ? [result.data.items] : []
          synced.push(...items)
          offset = result.data.nextOffset
          hasMore = result.data.hasMore
        }
      }

      const customers = synced.filter(entity => entity.type === 'customer')
      const suppliers = synced.filter(entity => entity.type === 'supplier')
      const data = { ...masterData, customers, suppliers, syncedAt: new Date().toISOString() }
      setMasterData(data)
      setEntities(synced)
      const saved = saveMasterData(client.id, data) && saveLocalEntities(client.id, synced)
      setMessage(saved
        ? `${customers.length} clientes e ${suppliers.length} fornecedores sincronizados.`
        : `${customers.length} clientes e ${suppliers.length} fornecedores carregados, mas sem espaço para cache local.`)
    } finally {
      setBusyAction('')
    }
  }

  return (
    <div className="container">
      <header className="app-header">
        <div className="company-brand" title={`${client.legalName} · NIF ${client.nif}`}>
          <span className="company-brand-mark">ERP</span>
          <div>
            <span className="eyebrow">Primavera Importer</span>
            <h1>{client.legalName || client.name}</h1>
          </div>
        </div>
        <AppTabs active={activeTab} onChange={setActiveTab} />
        <div className="app-header-actions">
          <span
            className={`status-pill ${settings.vatRegime === 'isento' ? 'vat-exempt' : 'vat-normal'}`}
            title={settings.vatRegime === 'isento' ? 'O IVA suportado nas compras é incluído no gasto e não gera linha de IVA dedutível.' : 'As compras podem gerar uma linha de IVA dedutível conforme o código configurado.'}
          >
            {settings.vatRegime === 'isento' ? 'IVA · sem direito à dedução' : 'IVA · regime normal'}
          </span>
          <span className={`status-pill ${online ? 'txt' : 'offline'}`}>{online ? 'SQL leitura + exportação TXT' : 'Offline · apenas consulta local'}</span>
          <PwaInstallButton />
          <button className="ghost company-switcher" title={`${client.legalName} · NIF ${client.nif}`} onClick={() => setClientId(null)}>Trocar empresa</button>
        </div>
      </header>

      {busyAction && (
        <div className="operation-progress" role="status">
          <span>{busyAction === 'test' ? 'A testar ligação' : busyAction === 'credentials' ? 'A guardar credenciais' : 'A sincronizar dados'}</span>
          <progress aria-label="Operação em curso" />
        </div>
      )}

      {activeTab === 'import' && (
        <ImportWorkspace
          client={client}
          model={model}
          year={ano}
          journal={diario}
          documentType={documento}
          startNumber={startNumDiario}
          debitAccount={modelSettings.debitAccount}
          creditAccount={modelSettings.creditAccount}
          rows={rows}
          preview={postingPreview}
          total={totals}
          message={message}
          masterData={masterData}
          onModelChange={value => {
            setModelId(value)
            updateSettings({ ...settings, selectedModelId: value })
          }}
          onYearChange={setAno}
          onJournalChange={value => {
            setDiario(value)
            updateSettings({ ...settings, diario: value })
          }}
          onDocumentChange={value => {
            setDocumento(value)
            updateSettings({ ...settings, documento: value })
          }}
          onStartNumberChange={value => {
            setStartNumDiario(value)
            updateSettings({ ...settings, startNumDiario: value })
          }}
          onAccountChange={updateModelSettings}
          onExcel={onExcel}
          onExport={exportTxt}
          onClear={() => setRows([])}
          onOpenSettings={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'purchases' && (
        <PurchasesPage
          clientId={client.id}
          clientName={client.legalName || client.name}
          year={ano}
          startNumber={startNumDiario}
          defaultJournal={diario}
          defaultDocument={documento}
          gatewayUrl={settings.gatewayUrl}
          companyCode={settings.primaveraCompanyCode}
          sql={{
            server: settings.sqlServer,
            database: settings.sqlDatabase,
            year: ano,
            user: settings.sqlUser,
            password: settings.sqlPassword,
          }}
          extensionToken={settings.extensionToken}
          masterData={masterData}
          vatRegime={settings.vatRegime}
          onDefaultJournalChange={value => {
            setDiario(value)
            updateSettings({ ...settings, diario: value })
          }}
          onDefaultDocumentChange={value => {
            setDocumento(value)
            updateSettings({ ...settings, documento: value })
          }}
        />
      )}

      {activeTab === 'control' && (
        <ControlPage clientId={client.id} masterData={masterData} />
      )}

      {activeTab === 'banking' && (
        <BankingSection
          clientId={client.id}
          accounts={masterData.accounts}
          gatewayUrl={settings.gatewayUrl}
          companyCode={settings.primaveraCompanyCode}
          extensionToken={settings.extensionToken}
          sqlServer={settings.sqlServer}
          sqlDatabase={settings.sqlDatabase}
          sqlUser={settings.sqlUser}
          sqlPassword={settings.sqlPassword}
          year={ano}
          startNumber={startNumDiario}
          defaultJournal={settings.postingsJournal}
          defaultDocument={settings.postingsDocument}
          onDefaultJournalChange={value => updateSettings({ ...settings, postingsJournal: value })}
          onDefaultDocumentChange={value => updateSettings({ ...settings, postingsDocument: value })}
          masterData={masterData}
        />
      )}

      {activeTab === 'automation' && (
        <MonthlyAutomationPage
          clientId={client.id} vatRegime={settings.vatRegime} gatewayUrl={settings.gatewayUrl}
          companyCode={settings.primaveraCompanyCode} onSync={syncPrimaveraMasterData} onNavigate={setActiveTab}
        />
      )}

      {activeTab === 'exceptions' && (
        <ExceptionCenter clientId={client.id} masterData={masterData} onNavigate={setActiveTab} />
      )}

      {activeTab === 'settings' && (
        <SettingsPage
          clientName={client.name}
          settings={settings}
          password={financasPassword}
          entityPaste={entityPaste}
          entityCount={entities.length}
          masterData={masterData}
          message={message}
          busy={busyAction}
          onSettingsChange={updateSettings}
          onPasswordChange={setFinancasPassword}
          onEntityPasteChange={setEntityPaste}
          onTest={testPrimaveraConnection}
          onSyncAccounting={syncPrimaveraMasterData}
          onSyncEntities={syncPrimaveraEntities}
          onSaveCredentials={saveFinancasCredentials}
          onAddEntities={parseEntitiesFromPaste}
          onClearEntities={() => {
            setEntities([])
            saveLocalEntities(client.id, [])
          }}
        />
      )}
    </div>
  )
}

export default App
