import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { cleanPowerShellError, decodePowerShellText, validateSqlSettings } from '../providers/sql-provider.mjs'

const here = dirname(fileURLToPath(import.meta.url))

test('aceita uma configuração SQL ERP Evolution válida', () => {
  assert.deepEqual(
    validateSqlSettings({ server: 'SRVSQL', database: 'PRIHELBOR', year: 2026 }),
    { server: 'SRVSQL', database: 'PRIHELBOR', year: 2026 },
  )
})

test('rejeita nomes SQL que possam injetar parâmetros', () => {
  assert.throws(
    () => validateSqlSettings({ server: 'SRVSQL;Password=x', database: 'PRIHELBOR', year: 2026 }),
    /Servidor SQL inválido/,
  )
})

test('o bridge SQL não contém comandos de escrita', async () => {
  const script = await readFile(join(here, '..', 'sql', 'Read-PrimaveraMasterData.ps1'), 'utf8')
  assert.equal(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER)\b/i.test(script), false)
})

test('corrige texto UTF-8 interpretado como Windows-1252', () => {
  const broken = Buffer.from('LigaÃ§Ã£o SQL invÃ¡lida.', 'utf8')
  assert.equal(decodePowerShellText(broken), 'Ligação SQL inválida.')
})

test('remove detalhes internos dos erros do PowerShell', () => {
  const raw = [
    'Ligação aberta. A localizar tabelas...',
    'Não foi encontrada uma coluna compatível em dbo.Movimentos: Data, DataMovimento',
    'At C:\\gateway\\sql\\Read-PrimaveraMasterData.ps1:65 char:22',
    'CategoryInfo : OperationStopped',
  ].join('\r\n')
  assert.equal(
    cleanPowerShellError(raw),
    'Não foi encontrada uma coluna compatível em dbo.Movimentos: Data, DataMovimento',
  )
})
