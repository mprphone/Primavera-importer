$ErrorActionPreference = "Stop"

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "Node.js já está instalado: $(node --version)"
    exit 0
}

Write-Host "Node.js não encontrado neste PC. A tentar instalar automaticamente..."

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Não foi possível instalar automaticamente (winget não está disponível)."
    Write-Host "Instala o Node.js manualmente:"
    Write-Host "  1. Vai a https://nodejs.org e descarrega a versao 'LTS'."
    Write-Host "  2. Corre o instalador (next, next, finish)."
    Write-Host "  3. Fecha e reabre o PowerShell, e corre este script outra vez."
    exit 1
}

& winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
    Write-Host "A instalação via winget falhou (código $LASTEXITCODE). Instala manualmente em https://nodejs.org."
    exit 1
}

# Atualiza o PATH desta sessão para já encontrar o "node" sem reabrir a janela.
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "Node.js instalado com sucesso: $(node --version)"
    exit 0
}

Write-Host ""
Write-Host "O Node.js foi instalado mas esta janela do PowerShell ainda nao o encontra."
Write-Host "Fecha esta janela, abre o PowerShell de novo, e corre o script de arranque outra vez."
exit 1
