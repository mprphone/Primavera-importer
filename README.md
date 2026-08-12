# ERP Evolution Importer

Importador React/Vite com configuração isolada por empresa.

## Empresas

Os perfis base estão em `src/core/clients.ts`. Cada empresa tem:

- identificação e código da empresa no ERP Evolution;
- modelos contabilísticos disponíveis;
- diário, documento e numeração inicial;
- contas a débito/crédito por modelo;
- lista local de entidades independente.

As alterações feitas na interface ficam guardadas no `localStorage` por empresa.

## Sincronização SQL e exportação TXT

A aplicação consulta dados mestres diretamente no SQL em modo de leitura e
continua a criar os lançamentos através de ficheiros TXT. O gateway local fica em:

`http://localhost:43120/api/primavera`

Endpoints previstos:

- `POST /health` — testar a ligação SQL;
- `POST /credentials/financas` — guardar as credenciais no cofre seguro do gateway;
- `POST /master-data/sync` — obter plano de contas, clientes, fornecedores e IVA;
- `POST /postings` — bloqueado no modo SQL; não escreve na base de dados.
- `POST /intrastat/sales` — lê as linhas dos documentos de faturação de um período para o Intrastat Office.

O gateway deve correr no PC Windows com acesso ao servidor SQL. Utiliza
autenticação integrada do Windows e executa apenas instruções `SELECT`.
A palavra-passe das Finanças nunca é guardada no `localStorage`.

## Executar frontend e backend

No Windows, arrancar primeiro o gateway:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\gateway\windows\Start-PrimaveraSqlGateway.ps1
```

Noutro terminal, arrancar a aplicação:

```powershell
npm run dev
```

Na interface, para a HELBOR, usar:

- servidor: `SRVSQL`;
- base de dados: `PRIHELBOR`;
- autenticação: conta Windows que já tem acesso pelo SSMS.

O bridge SQL está em `gateway/sql/Read-PrimaveraMasterData.ps1`. Resolve os nomes
das tabelas e colunas antes de consultar plano de contas, clientes, fornecedores
e IVA. Não contém `INSERT`, `UPDATE` ou `DELETE`.

O endpoint Intrastat usa a extensão central ligada ao `pri.mpr.pt`. Recebe um
intervalo de datas e uma lista fechada de tipos de documento, ignora documentos
anulados e devolve clientes, artigos, quantidades, valores e campos aduaneiros
disponíveis. A consulta continua estritamente em modo de leitura.

## Compras

O separador `Compras` permite:

- importar ficheiros CSV/XLS/XLSX exportados do e-Fatura;
- reconhecer cabeçalhos alternativos, tal como o importador ENI do AEF_MPR;
- evitar documentos duplicados por data, documento e NIF;
- memorizar contas, diário e tipo de documento por NIF do fornecedor;
- selecionar apenas as faturas pretendidas;
- gerar um TXT com fornecedor a crédito, gasto e IVA a débito;
- marcar automaticamente os documentos exportados como lançados.

Cada responsabilidade está isolada em `src/modules/purchases`.

### Recolha automática no e-Fatura

No PC Windows do gateway, executar uma vez:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\gateway\windows\Install-EfaturaAutomation.ps1
```

São necessários Python 3 e Google Chrome. O instalador adiciona Selenium; o
Selenium Manager trata do ChromeDriver compatível.

Depois:

1. arrancar o gateway;
2. guardar o utilizador/NIF e palavra-passe em `Configurações`;
3. abrir `Compras` → `Importar do e-Fatura`;
4. escolher ano e mês.

As credenciais são decifradas apenas no gateway e entregues ao coletor por
entrada standard, nunca por URL ou argumento. Se a AT pedir SMS/2FA, a recolha
é interrompida e requer intervenção manual.

## Bancos

O separador `Bancos` permite:

- selecionar uma conta da classe 12;
- importar o extrato contabilístico e o extrato bancário em CSV/XLS/XLSX;
- interpretar modelos com valor único ou colunas Débito/Crédito;
- reconciliar automaticamente por natureza, valor absoluto e tolerância de data;
- reconciliar grupos manualmente e desfazer reconciliações;
- guardar o estado independentemente por empresa.

A lógica foi adaptada do ReconcMpr e está isolada em `src/modules/banking`.

## Testar os motores do ERP Evolution v10 no Windows

O teste está em `primavera-bridge/connection-test`. No PC onde o ERP Evolution está
instalado:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Test-PrimaveraConnection.ps1
```

O teste compila com o .NET Framework 4.8 instalado e usa as DLL da pasta
`C:\Program Files\PRIMAVERA\SG100\Apl`. A palavra-passe é pedida localmente,
não aparece no ecrã e não é guardada.
