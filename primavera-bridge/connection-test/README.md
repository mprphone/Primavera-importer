# Teste de ligação ao ERP Evolution v10

Este utilitário confirma se uma empresa pode ser aberta através dos motores de
integração do ERP Evolution v10.

## Executar no PC Windows com o ERP Evolution instalado

1. Copiar esta pasta para o PC.
2. Abrir o PowerShell dentro da pasta.
3. Executar:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Test-PrimaveraConnection.ps1
```

O programa pede:

- código da empresa;
- utilizador do ERP Evolution;
- palavra-passe do ERP Evolution, sem a mostrar;
- usa por defeito a instância `Default`.

Também é possível indicar empresa e utilizador:

```powershell
.\Test-PrimaveraConnection.ps1 -Company CEV -User ADMIN
```

Se a instância não for `Default`:

```powershell
.\Test-PrimaveraConnection.ps1 -Company CEV -User ADMIN -Instance NOME_INSTANCIA
```

Este teste usa por defeito a plataforma `Evolution`. Para uma instalação
Executive:

```powershell
.\Test-PrimaveraConnection.ps1 -Platform Executive
```

A palavra-passe não é guardada em ficheiros, argumentos ou variáveis de
ambiente. O executável temporário é criado em:

`%LOCALAPPDATA%\PrimaveraImporter\ConnectionTest`

O script procura e copia automaticamente o `runtime.config` da instalação do
ERP Evolution. Se necessário, pode indicar o caminho manualmente:

```powershell
.\Test-PrimaveraConnection.ps1 -RuntimeConfig "C:\caminho\runtime.config"
```
