param(
    [string]$Company,
    [string]$User,
    [string]$Instance = "Default",
    [ValidateSet("Professional", "Executive", "Evolution")]
    [string]$Platform = "Evolution",
    [string]$PrimaveraPath = "C:\Program Files\PRIMAVERA\SG100\Apl",
    [string]$RuntimeConfig
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceFile = Join-Path $scriptDirectory "Program.cs"
$outputDirectory = Join-Path $env:LOCALAPPDATA "PrimaveraImporter\ConnectionTest"
$outputFile = Join-Path $outputDirectory "PrimaveraConnectionTest.exe"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $PrimaveraPath)) {
    throw "A pasta do ERP Evolution não existe: $PrimaveraPath"
}

if (-not (Test-Path $compiler)) {
    throw "Não foi encontrado o compilador do .NET Framework 64-bit: $compiler"
}

$requiredAssemblies = @(
    "ErpBS100.dll",
    "StdBE100.dll",
    "ConstantesPrimavera100.dll"
)

foreach ($assembly in $requiredAssemblies) {
    $assemblyPath = Join-Path $PrimaveraPath $assembly
    if (-not (Test-Path $assemblyPath)) {
        throw "Falta a biblioteca necessária: $assemblyPath"
    }
}

if ([string]::IsNullOrWhiteSpace($RuntimeConfig)) {
    $RuntimeConfig = Get-ChildItem `
        -Path (Split-Path -Parent $PrimaveraPath) `
        -Filter "runtime.config" `
        -File `
        -Recurse `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}

if ([string]::IsNullOrWhiteSpace($RuntimeConfig) -or -not (Test-Path $RuntimeConfig)) {
    throw "Não foi encontrado o runtime.config do ERP Evolution. Procure-o com: Get-ChildItem 'C:\Program Files\PRIMAVERA' -Recurse -Filter runtime.config"
}

if ([string]::IsNullOrWhiteSpace($Company)) {
    $Company = Read-Host "Código da empresa no ERP Evolution"
}

if ([string]::IsNullOrWhiteSpace($User)) {
    $User = Read-Host "Utilizador do ERP Evolution"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Copy-Item $RuntimeConfig (Join-Path $outputDirectory "runtime.config") -Force
Write-Host "Configuração encontrada: $RuntimeConfig" -ForegroundColor DarkCyan

Write-Host "A compilar o teste..." -ForegroundColor Cyan
& $compiler `
    /nologo `
    /target:exe `
    /platform:x64 `
    /optimize+ `
    /out:$outputFile `
    $sourceFile

if ($LASTEXITCODE -ne 0) {
    throw "A compilação falhou com o código $LASTEXITCODE."
}

Write-Host "Teste compilado. A palavra-passe será pedida sem aparecer no ecrã." -ForegroundColor Cyan
Write-Host ""

Push-Location $outputDirectory
try {
& $outputFile $PrimaveraPath $Company $User $Instance $Platform
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
