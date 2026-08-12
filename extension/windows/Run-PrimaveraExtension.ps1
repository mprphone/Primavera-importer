$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Split-Path -Parent $scriptDirectory
$configPath = Join-Path $installRoot "config.json"
$agentPath = Join-Path $installRoot "agent.mjs"
$logPath = Join-Path $installRoot "extension.log"
$lockPath = Join-Path $installRoot "extension.lock"
$runnerPidPath = Join-Path $installRoot "runner.pid"

if (-not (Test-Path $configPath) -or -not (Test-Path $agentPath)) {
    exit 1
}

# Impede duas cópias desta instalação de correrem ao mesmo tempo.
try {
    $lockStream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    exit 0
}

try {
    Set-Content $runnerPidPath $PID -Encoding ASCII

    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 5MB) {
        Move-Item $logPath "$logPath.anterior" -Force
    }

    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $secureToken = ConvertTo-SecureString $config.protectedToken
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

    try {
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
        $env:PRIMAVERA_API_URL = $config.apiUrl
        $env:PRIMAVERA_EXTENSION_TOKEN = $token
        $env:PRIMAVERA_PROVIDER = $config.provider

        $node = (Get-Command node -ErrorAction Stop).Source

        while ($true) {
            "[{0}] A iniciar a extensão local." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") |
                Out-File $logPath -Append -Encoding utf8

            & $node $agentPath 2>&1 |
                Out-File $logPath -Append -Encoding utf8

            "[{0}] O processo terminou (código {1}). Nova tentativa dentro de 10 segundos." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $LASTEXITCODE |
                Out-File $logPath -Append -Encoding utf8
            Start-Sleep -Seconds 10
        }
    } finally {
        if ($tokenPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        }
        Remove-Item Env:PRIMAVERA_EXTENSION_TOKEN -ErrorAction SilentlyContinue
    }
} catch {
    "[{0}] Erro no arranque: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message |
        Out-File $logPath -Append -Encoding utf8
    exit 1
} finally {
    Remove-Item $runnerPidPath -Force -ErrorAction SilentlyContinue
    if ($lockStream) {
        $lockStream.Dispose()
    }
}
