param(
    [string]$AllowedOrigin = "http://localhost:5173",
    [int]$Port = 43120
)

$ErrorActionPreference = "Stop"
$gatewayDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$server = Join-Path $gatewayDirectory "server.mjs"
$runtimeDirectory = Join-Path $gatewayDirectory "runtime"
$keyFile = Join-Path $runtimeDirectory ".gateway-key"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js não está instalado ou não está disponível no PATH."
}

if (-not (Test-Path $server)) {
    throw "O servidor do gateway não foi encontrado: $server"
}

$env:PRIMAVERA_PROVIDER = "sql"
$env:PRIMAVERA_POWERSHELL = "powershell.exe"
$env:PRIMAVERA_GATEWAY_HOST = "127.0.0.1"
$env:PRIMAVERA_GATEWAY_PORT = [string]$Port
$env:PRIMAVERA_ALLOWED_ORIGIN = $AllowedOrigin

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if (-not (Test-Path $keyFile)) {
    $key = ([Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N"))
    Set-Content -Path $keyFile -Value $key -Encoding ASCII -NoNewline
    & attrib +H $keyFile
}
$env:PRIMAVERA_GATEWAY_KEY = (Get-Content $keyFile -Raw).Trim()
if ($env:PRIMAVERA_GATEWAY_KEY.Length -lt 24) {
    throw "A chave local do gateway está inválida: $keyFile"
}

Write-Host "A iniciar o gateway SQL do ERP Evolution..." -ForegroundColor Cyan
Write-Host "Conta Windows: $env:USERDOMAIN\$env:USERNAME"
Write-Host "API: http://127.0.0.1:$Port/api/primavera"
Write-Host "Modo: apenas leitura SQL + exportação TXT"
Write-Host ""

& node $server
exit $LASTEXITCODE
