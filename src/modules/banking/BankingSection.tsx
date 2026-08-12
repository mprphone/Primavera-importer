import React, { useState } from 'react'
import { Account } from '../../core/master-data'
import { PrimaveraMasterData } from '../../core/master-data'
import { BankingPage } from './BankingPage'
import { PostingsPage } from '../postings/PostingsPage'

type SubTab = 'reconciliation' | 'postings'

type Props = {
  clientId: string
  accounts: Account[]
  gatewayUrl: string
  companyCode: string
  extensionToken: string
  sqlServer: string
  sqlDatabase: string
  sqlUser: string
  sqlPassword: string
  year: number
  startNumber: number
  defaultJournal: string
  defaultDocument: string
  onDefaultJournalChange: (value: string) => void
  onDefaultDocumentChange: (value: string) => void
  masterData: PrimaveraMasterData
}

export function BankingSection({ clientId, accounts, ...rest }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('reconciliation')
  const [account, setAccount] = useState(() => accounts.find(item => item.code.startsWith('12'))?.code ?? '')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  return (
    <section className={`module-page banking-page${subTab === 'reconciliation' ? ' banking-reconciliation-page' : ''}`}>
      <nav className="banking-subtabs" aria-label="Secção de bancos">
        <button className={subTab === 'reconciliation' ? 'active' : ''} onClick={() => setSubTab('reconciliation')}>Reconciliação</button>
        <button className={subTab === 'postings' ? 'active' : ''} onClick={() => setSubTab('postings')}>Lançamento</button>
      </nav>

      {subTab === 'reconciliation' && (
        <BankingPage
          clientId={clientId}
          accounts={accounts}
          account={account}
          month={month}
          onAccountChange={setAccount}
          onMonthChange={setMonth}
          gatewayUrl={rest.gatewayUrl}
          companyCode={rest.companyCode}
          extensionToken={rest.extensionToken}
          sqlServer={rest.sqlServer}
          sqlDatabase={rest.sqlDatabase}
          sqlUser={rest.sqlUser}
          sqlPassword={rest.sqlPassword}
        />
      )}

      {subTab === 'postings' && (
        <PostingsPage
          clientId={clientId}
          account={account}
          month={month}
          year={rest.year}
          startNumber={rest.startNumber}
          defaultJournal={rest.defaultJournal}
          defaultDocument={rest.defaultDocument}
          onDefaultJournalChange={rest.onDefaultJournalChange}
          onDefaultDocumentChange={rest.onDefaultDocumentChange}
          masterData={rest.masterData}
        />
      )}
    </section>
  )
}
