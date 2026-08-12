import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFinancasCredentials } from '../credentials/credential-store.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'fetch_efatura.py')

function pythonCommand() {
  const configured = process.env.PRIMAVERA_PYTHON
  return configured ? { command: configured, prefix: [] } : { command: 'python3', prefix: [] }
}

export async function fetchEfaturaInvoices({ runtimeDirectory, companyCode, dateFrom, dateTo }) {
  const credentials = await readFinancasCredentials(runtimeDirectory, companyCode).catch(error => {
    if (error?.code === 'ENOENT') throw new Error('Guarda primeiro as credenciais das Finanças nas Configurações.')
    throw error
  })
  const python = pythonCommand()

  return new Promise((resolve, reject) => {
    const child = spawn(python.command, [...python.prefix, script, dateFrom, dateTo], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('A recolha no e-Fatura ultrapassou 3 minutos e foi terminada.'))
    }, 180_000)

    child.stdin.end(JSON.stringify({ user: credentials.user, password: credentials.password }))
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => {
      stderr.push(chunk)
      const progress = chunk.toString('utf8').trim()
      if (progress) console.log(`[E-FATURA] ${progress}`)
    })
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Não foi possível iniciar o Python/Selenium: ${error.message}`))
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const output = Buffer.concat(stdout).toString('utf8').trim()
      const errorOutput = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) return reject(new Error(errorOutput.split(/\r?\n/).at(-1) || 'A recolha e-Fatura falhou.'))
      try {
        resolve(JSON.parse(output))
      } catch {
        reject(new Error('O coletor e-Fatura devolveu uma resposta inválida.'))
      }
    })
  })
}
