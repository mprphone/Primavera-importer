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
    { server: 'SRVSQL', database: 'PRIHELBOR', year: 2026, user: '', password: '' },
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

test('o bridge é compatível com SQL Server anterior a 2012', async () => {
  const script = await readFile(join(here, '..', 'sql', 'Read-PrimaveraMasterData.ps1'), 'utf8')
  assert.equal(/\bTRY_(CONVERT|CAST)\s*\(/i.test(script), false)
  assert.equal(/\bDATEFROMPARTS\s*\(/i.test(script), false)
  assert.equal(/\bOFFSET\s+@?\w+\s+ROWS\s+FETCH\b/i.test(script), false)
})

test('a consulta de compras devolve a entidade para lançamentos diretos no banco', async () => {
  const script = await readFile(join(here, '..', 'sql', 'Read-PrimaveraMasterData.ps1'), 'utf8')
  assert.match(script, /Find-Column \$movementsTable @\("TipoEntidade"/)
  assert.match(script, /Find-Column \$movementsTable @\("Entidade"/)
  assert.match(script, /Append\('\",\"entityType\":\"'/)
  assert.match(script, /Append\('\",\"entityCode\":\"'/)
})

test('o bridge expõe a consulta Intrastat parametrizada e apenas de leitura', async () => {
  const script = await readFile(join(here, '..', 'sql', 'Read-PrimaveraMasterData.ps1'), 'utf8')
  assert.match(script, /"IntrastatSales"/)
  assert.match(script, /@docType\$index/)
  assert.match(script, /lines\s*=\s*@\(\$salesLines\)/)
  assert.doesNotMatch(script, /^\s*\$entityType\s*=/im)
  assert.match(script, /\$rowEntityType\s*=/)
})

test('corrige texto UTF-8 interpretado como Windows-1252', () => {
  const broken = Buffer.from('LigaÃ§Ã£o SQL invÃ¡lida.', 'utf8')
  assert.equal(decodePowerShellText(broken), 'Ligação SQL inválida.')
})

test('remove detalhes internos dos erros do PowerShell', () => {
  const raw = [
    'Ligação aberta. A localizar tabelas...',
    'Não foi encontrada uma coluna compatível em dbo.Movimentos: Data, DataMovimento',
    'At C:\\extension\\sql\\Read-PrimaveraMasterData.ps1:65 char:22',
    'CategoryInfo : OperationStopped',
  ].join('\r\n')
  assert.equal(
    cleanPowerShellError(raw),
    'Não foi encontrada uma coluna compatível em dbo.Movimentos: Data, DataMovimento',
  )
})
