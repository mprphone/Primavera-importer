$ErrorActionPreference = "Stop"
$gatewayDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$requirements = Join-Path $gatewayDirectory "efatura\requirements.txt"

$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $python) {
    throw "Python 3 não está instalado. Instala-o a partir de https://www.python.org/downloads/windows/"
}

$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
if (-not ($chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1)) {
    throw "Google Chrome não foi encontrado. Instala o Chrome antes de configurar o Selenium."
}

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m pip install --upgrade pip
    & py -3 -m pip install -r $requirements
} else {
    & python -m pip install --upgrade pip
    & python -m pip install -r $requirements
}

Write-Host ""
Write-Host "Automação e-Fatura instalada. O Selenium utilizará o Google Chrome existente." -ForegroundColor Green
