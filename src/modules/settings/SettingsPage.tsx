import React, { useState } from 'react'
import { EXTENSION_DOWNLOAD_URL } from '../../core/api-config'
import { ClientSettings } from '../../core/client-settings'
import { issueExtensionToken } from '../../core/extension-token'
import { PrimaveraMasterData } from '../../core/master-data'

type BusyAction = 'test' | 'credentials' | 'sync' | 'entities' | ''

type Props = {
  clientName: string
  settings: ClientSettings
  password: string
  entityPaste: string
  entityCount: number
  masterData: PrimaveraMasterData
  message: string
  busy: BusyAction
  onSettingsChange: (next: ClientSettings) => void
  onPasswordChange: (value: string) => void
  onEntityPasteChange: (value: string) => void
  onTest: () => void
  onSyncAccounting: () => void
  onSyncEntities: () => void
  onSaveCredentials: () => void
  onAddEntities: () => void
  onClearEntities: () => void
}

export function SettingsPage(props: Props) {
  const { settings, masterData } = props
  const update = (field: keyof ClientSettings, value: string) => props.onSettingsChange({ ...settings, [field]: value })
  const [issuingToken, setIssuingToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)

  const generateNewConnection = async () => {
    const label = window.prompt('Nome para esta ligação (ex.: nome do escritório/PC):', props.clientName)
    if (label === null) return
    setIssuingToken(true)
    setTokenCopied(false)
    const token = await issueExtensionToken(label || 'Sem nome')
    if (token) update('extensionToken', token)
    setIssuingToken(false)
  }

  const copyToken = () => {
    navigator.clipboard?.writeText(settings.extensionToken)
    setTokenCopied(true)
  }

  return (
    <div className="card card-soft-yellow settings-card settings-page">
      <h2>Configurações de {props.clientName}</h2>
      <p className="muted">Estas configurações e os dados sincronizados ficam separados das restantes empresas.</p>
      <div className="settings-columns">
        <section>
          <h3>Sincronização SQL</h3>
          <p className="security-note">A ligação é exclusivamente de leitura. Os lançamentos continuam a ser exportados por TXT.</p>
          <label>Endereço da API ERP Evolution<input value={settings.gatewayUrl} onChange={event => update('gatewayUrl', event.target.value)} /></label>
          <label>Servidor SQL<input value={settings.sqlServer} onChange={event => update('sqlServer', event.target.value)} placeholder="Ex.: SRVSQL" /></label>
          <label>Base de dados da empresa<input value={settings.sqlDatabase} onChange={event => update('sqlDatabase', event.target.value)} placeholder="Ex.: PRIHELBOR" /></label>
          <label>Utilizador SQL (opcional)<input value={settings.sqlUser} onChange={event => update('sqlUser', event.target.value)} placeholder="Deixa em branco para usar a conta Windows" /></label>
          {settings.sqlUser && (
            <label>Palavra-passe SQL<input type="password" value={settings.sqlPassword} onChange={event => update('sqlPassword', event.target.value)} /></label>
          )}
          <p className="muted small">Se a extensão não tiver acesso pela conta Windows, indica aqui o login SQL que o próprio ERP Evolution já usa para ligar a esta base de dados (não precisas de configurar nada no SQL Server).</p>
          <label>Código da empresa no ERP Evolution<input value={settings.primaveraCompanyCode} onChange={event => update('primaveraCompanyCode', event.target.value)} /></label>
          <label>Regime de IVA
            <select value={settings.vatRegime} onChange={event => update('vatRegime', event.target.value)}>
              <option value="normal">Normal</option>
              <option value="isento">Sem direito à dedução de IVA</option>
            </select>
          </label>
          {settings.vatRegime === 'isento' && (
            <p className="muted small">Sem dedução: o IVA suportado nas compras fica incluído no valor lançado na conta de gasto, sem movimento numa conta 243 de IVA dedutível.</p>
          )}
          <div className="action-row">
            <button onClick={props.onTest} disabled={Boolean(props.busy)}>{props.busy === 'test' ? 'A testar…' : 'Testar SQL'}</button>
            <button className="secondary" onClick={props.onSyncAccounting} disabled={Boolean(props.busy)}>{props.busy === 'sync' ? 'A sincronizar…' : 'Sincronizar contabilidade'}</button>
            <button className="secondary" onClick={props.onSyncEntities} disabled={Boolean(props.busy)}>{props.busy === 'entities' ? 'A sincronizar entidades…' : 'Sincronizar clientes/fornecedores'}</button>
          </div>
          <p className="muted small">A sincronização SQL/ERP Evolution precisa da extensão local no PC com acesso ao SQL. Depois de instalada, arranca automaticamente com o Windows e fica em segundo plano — uma só instalação serve todas as empresas desse SQL Server.</p>
          <label>Token da extensão
            <input
              value={settings.extensionToken}
              onChange={event => { update('extensionToken', event.target.value); setTokenCopied(false) }}
              placeholder="Cola aqui o token, se já tiveres uma extensão a correr para este SQL Server"
            />
          </label>
          <div className="action-row">
            <a className="button-like secondary-upload" href={EXTENSION_DOWNLOAD_URL}>Descarregar instalador (.zip)</a>
            <button className="secondary" onClick={generateNewConnection} disabled={issuingToken}>
              {issuingToken ? 'A gerar…' : 'Gerar nova ligação'}
            </button>
            {settings.extensionToken && (
              <button className="secondary" onClick={copyToken}>{tokenCopied ? 'Copiado!' : 'Copiar token'}</button>
            )}
          </div>
          <p className="muted small">
            Se já tens uma extensão a correr para o mesmo SQL Server (de outra empresa), cola aqui o mesmo token em
            vez de gerares um novo. "Gerar nova ligação" só é para a primeira empresa de cada SQL Server/PC novo.
            O .zip inclui o INSTALAR.bat: corre-o uma vez e a extensão fica a arrancar automaticamente em segundo plano.
          </p>
        </section>
        <section>
          <h3>Portal das Finanças</h3>
          <label>Utilizador / NIF<input value={settings.financasUser} onChange={event => update('financasUser', event.target.value)} autoComplete="username" /></label>
          <label>Palavra-passe<input type="password" value={props.password} onChange={event => props.onPasswordChange(event.target.value)} autoComplete="current-password" placeholder="Não é guardada no navegador" /></label>
          <button onClick={props.onSaveCredentials} disabled={Boolean(props.busy)}>{props.busy === 'credentials' ? 'A guardar…' : 'Guardar na API segura'}</button>
          <p className="security-note">A palavra-passe nunca é guardada no navegador nem no localStorage.</p>
        </section>
      </div>

      <section className="sync-summary">
        <div><h3>Dados do ERP Evolution</h3><p className="muted small">{masterData.syncedAt ? `Última sincronização: ${new Date(masterData.syncedAt).toLocaleString('pt-PT')}` : 'Ainda não foi efetuada nenhuma sincronização.'}</p></div>
        <div className="sync-counts">
          <span><b>{masterData.accounts.length}</b> contas</span><span><b>{masterData.customers.length}</b> clientes</span>
          <span><b>{masterData.suppliers.length}</b> fornecedores</span><span><b>{masterData.vatRates.length}</b> taxas IVA</span>
          <span><b>{masterData.journals.length}</b> diários</span><span><b>{masterData.documents.length}</b> documentos</span>
          <span><b>{masterData.accountingYears.length}</b> exercícios</span>
        </div>
        {masterData.accounts.length > 0 && masterData.customers.length + masterData.suppliers.length === 0 && (
          <p className="muted small">Ainda sem clientes/fornecedores sincronizados — usa o botão "Sincronizar clientes/fornecedores" (é um passo separado da contabilidade).</p>
        )}
      </section>

      <div className="settings-columns entity-settings">
        <section>
          <h3>Entidades manuais</h3>
          <p className="muted small">Formato: Tipo (F/C), Código, Nome, NIF, Palavras-chave.</p>
          <textarea value={props.entityPaste} onChange={event => props.onEntityPasteChange(event.target.value)} placeholder={'F\t500844321\tBanco Santander Totta SA\t\tSANTANDER|TOTTA'} />
          <div className="action-row">
            <button onClick={props.onAddEntities} disabled={!props.entityPaste.trim()}>Adicionar</button>
            <button className="secondary" onClick={props.onClearEntities} disabled={!props.entityCount}>Limpar entidades</button>
            <span className="muted">Guardadas: <b>{props.entityCount}</b></span>
          </div>
        </section>
        <section>
          <h3>O que será sincronizado</h3>
          <ul className="sync-list">
            <li>Plano de contas e estado das contas</li><li>Clientes e fornecedores</li><li>Códigos e taxas de IVA</li>
            <li>Diários e documentos contabilísticos</li><li>Exercícios, moedas e séries disponíveis</li>
          </ul>
          {masterData.warnings.length > 0 && <details className="sync-warnings"><summary>{masterData.warnings.length} tabelas opcionais não identificadas</summary><ul>{masterData.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
        </section>
      </div>
      {props.message && <div className="notice">{props.message}</div>}
    </div>
  )
}
