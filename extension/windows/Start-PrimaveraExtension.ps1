param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$ApiUrl = "wss://pri.mpr.pt/api/extension/ws",
    [string]$Provider = "sql"
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$agent = Join-Path (Split-Path -Parent $scriptDirectory) "agent.mjs"
$extensionRoot = Split-Path -Parent $agent

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    & (Join-Path $scriptDirectory "Install-NodeJs.ps1")
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

if (-not (Test-Path (Join-Path $extensionRoot "node_modules"))) {
    Write-Host "A instalar dependências (npm install)..."
    Push-Location $extensionRoot
    & npm install
    Pop-Location
}

Write-Host "A iniciar a extensão local do ERP Evolution Importer..."
Write-Host "API central: $ApiUrl"
Write-Host "Fornecedor: $Provider"
Write-Host "Esta instalação vai servir todas as empresas cujas bases de dados estejam neste SQL Server."

$env:PRIMAVERA_API_URL = $ApiUrl
$env:PRIMAVERA_EXTENSION_TOKEN = $Token
$env:PRIMAVERA_PROVIDER = $Provider

& node $agent
exit $LASTEXITCODE
