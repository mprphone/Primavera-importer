param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$ApiUrl = "wss://pri.mpr.pt/api/extension/ws",
    [string]$Provider = "sql"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "O token da extensão não pode ficar vazio."
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceRoot = Split-Path -Parent $scriptDirectory
$installRoot = Join-Path $env:LOCALAPPDATA "ERP Evolution Importer\Extension"
$installWindows = Join-Path $installRoot "windows"
$startupDirectory = [Environment]::GetFolderPath("Startup")
$startupLauncher = Join-Path $startupDirectory "ERP Evolution Importer.vbs"
$runnerPath = Join-Path $installWindows "Run-PrimaveraExtension.ps1"
$runnerPidPath = Join-Path $installRoot "runner.pid"
$logPath = Join-Path $installRoot "extension.log"

Write-Host "A verificar o Node.js..."
& (Join-Path $scriptDirectory "Install-NodeJs.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível preparar o Node.js."
}

# O winget pode ter atualizado o PATH da máquina durante esta instalação.
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "O Node.js não ficou disponível. Reinicia o Windows e corre o INSTALAR.bat novamente."
}

# Numa atualização, termina apenas a cópia anteriormente instalada por este
# instalador. A validação da linha de comandos evita parar outros processos.
if (Test-Path $runnerPidPath) {
    $installedRunnerPid = 0
    [void][int]::TryParse((Get-Content $runnerPidPath -Raw).Trim(), [ref]$installedRunnerPid)
    if ($installedRunnerPid -gt 0) {
        $runnerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $installedRunnerPid" -ErrorAction SilentlyContinue
        if ($runnerProcess -and $runnerProcess.CommandLine -like "*Run-PrimaveraExtension.ps1*") {
            Get-CimInstance Win32_Process -Filter "ParentProcessId = $installedRunnerPid" -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*agent.mjs*" } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Stop-Process -Id $installedRunnerPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 600
        }
    }
}

Write-Host "A copiar a extensão para $installRoot..."
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
New-Item -ItemType Directory -Path $installWindows -Force | Out-Null

$files = @(
    "agent.mjs",
    "command-handlers.mjs",
    "package.json",
    "package-lock.json"
)
$directories = @("lib", "providers", "seed", "sql")
$windowsFiles = @(
    "Run-PrimaveraExtension.ps1",
    "Start-PrimaveraExtensionHidden.vbs"
)

foreach ($file in $files) {
    Copy-Item (Join-Path $sourceRoot $file) (Join-Path $installRoot $file) -Force
}
foreach ($directory in $directories) {
    Copy-Item (Join-Path $sourceRoot $directory) $installRoot -Recurse -Force
}
foreach ($file in $windowsFiles) {
    Copy-Item (Join-Path $scriptDirectory $file) (Join-Path $installWindows $file) -Force
}

Write-Host "A instalar as dependências da extensão..."
Push-Location $installRoot
try {
    & npm.cmd install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "A instalação das dependências falhou."
    }
} finally {
    Pop-Location
}

# Sem uma chave explícita, o Windows protege o valor com DPAPI. Só o mesmo
# utilizador do Windows neste PC o consegue recuperar.
$secureToken = ConvertTo-SecureString $Token.Trim() -AsPlainText -Force
$protectedToken = ConvertFrom-SecureString $secureToken
@{
    protectedToken = $protectedToken
    apiUrl = $ApiUrl
    provider = $Provider
} | ConvertTo-Json | Set-Content (Join-Path $installRoot "config.json") -Encoding UTF8

Copy-Item (Join-Path $scriptDirectory "Start-PrimaveraExtensionHidden.vbs") $startupLauncher -Force

Write-Host "A ativar o arranque automático e a iniciar agora..."
if (Test-Path $logPath) {
    Move-Item $logPath "$logPath.anterior" -Force
}
& "$env:SystemRoot\System32\wscript.exe" (Join-Path $installWindows "Start-PrimaveraExtensionHidden.vbs")

$registered = $false
for ($attempt = 0; $attempt -lt 12; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if ((Test-Path $logPath) -and (Select-String -Path $logPath -Pattern "Registado. Pronto para receber pedidos" -Quiet)) {
        $registered = $true
        break
    }
}

if ($registered) {
    Write-Host ""
    Write-Host "Extensão ligada com sucesso." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Warning "A extensão ficou instalada e a arrancar em segundo plano, mas ainda não confirmou a ligação. Usa 'Testar SQL' nas Configurações. Se falhar, consulta: $logPath"
}

Write-Host "Arranque automático: $startupLauncher"
Write-Host "Registo de diagnóstico: $logPath"
