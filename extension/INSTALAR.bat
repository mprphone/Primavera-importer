@echo off
setlocal
cd /d "%~dp0"

echo ===========================================================
echo  Instalacao da extensao local do ERP Evolution Importer
echo ===========================================================
echo.
echo Esta instalacao liga este PC ao SQL Server do ERP Evolution e serve
echo TODAS as empresas cujas bases de dados estejam neste servidor.
echo.

if "%~1"=="" (
    set /p TOKEN="Token da extensao (gerado em Configuracoes na app): "
) else (
    set "TOKEN=%~1"
)

echo.
echo A desbloquear ficheiros descarregados da internet...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File"

echo.
echo A instalar a extensao em segundo plano...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Install-PrimaveraExtension.ps1" -Token "%TOKEN%" -Provider sql
if errorlevel 1 goto :erro

echo.
echo ===========================================================
echo  Instalacao concluida
echo ===========================================================
echo.
echo A extensao ficou a correr em segundo plano e vai arrancar
echo automaticamente quando entrares no Windows.
echo Ja podes fechar esta janela.
echo.
pause
exit /b 0

:erro
echo.
echo A instalacao nao ficou concluida. Consulta o erro apresentado
echo acima ou contacta o administrador.
echo.
pause
exit /b 1
