import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bridgeScript = join(here, '..', 'sql', 'Read-PrimaveraMasterData.ps1')

export function decodePowerShellText(buffer) {
  const text = buffer.toString('utf8')
  if (!/[ÃÂ]/.test(text)) return text
  const repaired = Buffer.from(text, 'latin1').toString('utf8')
  return repaired.includes('\uFFFD') ? text : repaired
}

export function cleanPowerShellError(value) {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const detail = lines.find(line =>
    !/^(Ligação aberta|A localizar tabelas|A ler |At |Em |CategoryInfo|FullyQualifiedErrorId|\+|~)/i.test(line)
  )
  return (detail ?? lines[0] ?? 'Erro ao consultar o SQL ERP Evolution.')
    .replace(/^\w+\s*:\s*/, '')
    .replace(/\s+At\s+.+$/i, '')
    .trim()
}

export function validateSqlSettings(settings) {
  if (!settings || typeof settings !== 'object') throw new Error('Configuração SQL em falta.')
  if (typeof settings.server !== 'string' || !/^[A-Za-z0-9_.\\-]{1,120}$/.test(settings.server)) {
    throw new Error('Servidor SQL inválido.')
  }
  if (typeof settings.database !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(settings.database)) {
    throw new Error('Base de dados SQL inválida.')
  }
  const year = Number(settings.year ?? new Date().getFullYear())
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('Ano contabilístico inválido.')
  return { server: settings.server, database: settings.database, year }
}

function runBridge(mode, settings, extra = {}) {
  const sql = validateSqlSettings(settings)
  const executable = process.env.PRIMAVERA_POWERSHELL ?? 'powershell.exe'
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', bridgeScript,
    '-Mode', mode,
    '-Server', sql.server,
    '-Database', sql.database,
    '-Year', String(sql.year),
  ]
  if (mode === 'Entities') {
    args.push(
      '-EntityType', extra.entityType,
      '-Offset', String(extra.offset ?? 0),
      '-Limit', String(extra.limit ?? 500),
    )
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    const stdout = []
    const stderr = []
    let finished = false
    const timeout = setTimeout(() => {
      if (finished) return
      child.kill()
      reject(new Error('A consulta SQL ultrapassou 35 segundos e foi terminada.'))
    }, 35_000)
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => {
      stderr.push(chunk)
      const progress = decodePowerShellText(chunk).trim()
      if (progress) console.log(`[SQL] ${progress}`)
    })
    child.on('error', error => {
      finished = true
      clearTimeout(timeout)
      reject(new Error(`Não foi possível iniciar o PowerShell (${executable}): ${error.message}`))
    })
    child.on('close', code => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      const output = decodePowerShellText(Buffer.concat(stdout)).trim()
      const errorOutput = decodePowerShellText(Buffer.concat(stderr)).trim()
      if (code !== 0) {
        return reject(new Error(cleanPowerShellError(errorOutput || output || `Bridge SQL terminou com código ${code}.`)))
      }
      try {
        resolve(JSON.parse(output))
      } catch {
        reject(new Error(`Resposta inválida do bridge SQL: ${output || errorOutput}`))
      }
    })
  })
}

export class SqlPrimaveraProvider {
  async health(_companyCode, options) {
    const result = await runBridge('Health', options?.sql)
    return {
      success: true,
      message: `Ligação SQL confirmada a ${result.server}/${result.database} com autenticação Windows.`,
    }
  }

  async syncMasterData(_companyCode, options) {
    return runBridge('Sync', options?.sql)
  }

  async syncEntities(_companyCode, options) {
    return runBridge('Entities', options?.sql, {
      entityType: options?.entityType,
      offset: options?.offset,
      limit: options?.limit,
    })
  }

  async createPostings() {
    return {
      success: false,
      message: 'A escrita direta no SQL está bloqueada. Exporte o ficheiro TXT para importar no ERP Evolution.',
    }
  }
}
