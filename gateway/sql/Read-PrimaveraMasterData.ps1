param(
    [ValidateSet("Health", "Sync", "Entities", "Ledger")]
    [string]$Mode,
    [string]$Server,
    [string]$Database,
    [int]$Year,
    [ValidateSet("customer", "supplier")]
    [string]$EntityType = "customer",
    [int]$Offset = 0,
    [int]$Limit = 500,
    [string]$SqlUser = "",
    [string]$SqlPassword = "",
    [string]$Account = "",
    [string]$DateFrom = "",
    [string]$DateTo = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ($Server -notmatch '^[A-Za-z0-9_.\\-]{1,120}$') { throw "Servidor SQL inválido." }
if ($Database -notmatch '^[A-Za-z0-9_-]{1,120}$') { throw "Base de dados SQL inválida." }

$auth = if ($SqlUser) {
    $escapedPassword = $SqlPassword.Replace("'", "''")
    "User Id=$SqlUser;Password=$escapedPassword"
} else {
    "Integrated Security=True"
}
$connectionString = "Server=$Server;Database=$Database;$auth;Encrypt=False;TrustServerCertificate=True;Application Name=ERP Evolution Importer ReadOnly"
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)

function Invoke-Select([string]$Query, [hashtable]$Parameters = @{}) {
    $command = $connection.CreateCommand()
    $command.CommandText = $Query
    $command.CommandTimeout = 30
    foreach ($name in $Parameters.Keys) {
        [void]$command.Parameters.AddWithValue($name, $Parameters[$name])
    }
    $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
    $table = [System.Data.DataTable]::new()
    [void]$adapter.Fill($table)
    # A DataTable é enumerável no PowerShell. A vírgula impede que seja
    # transformada automaticamente num array de DataRow.
    return ,$table
}

function Find-Table([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        $result = Invoke-Select "SELECT TOP 1 s.name AS SchemaName, t.name AS TableName FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE LOWER(t.name)=LOWER(@name)" @{ "@name" = $candidate }
        if ($result.Rows.Count -gt 0) {
            return [pscustomobject]@{ Schema = $result.Rows[0].SchemaName; Name = $result.Rows[0].TableName }
        }
    }
    return $null
}

function Find-Column($Table, [string[]]$Candidates, [bool]$Required = $true) {
    foreach ($candidate in $Candidates) {
        $result = Invoke-Select "SELECT TOP 1 c.name AS ColumnName FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name=@schema AND t.name=@table AND LOWER(c.name)=LOWER(@column)" @{
            "@schema" = $Table.Schema; "@table" = $Table.Name; "@column" = $candidate
        }
        if ($result.Rows.Count -gt 0) { return [string]$result.Rows[0].ColumnName }
    }
    if ($Required) {
        $allColumnsResult = Invoke-Select "SELECT c.name AS ColumnName FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name=@schema AND t.name=@table ORDER BY c.name" @{
            "@schema" = $Table.Schema; "@table" = $Table.Name
        }
        $allColumnNames = @($allColumnsResult.Rows | ForEach-Object { $_.ColumnName }) -join ', '
        throw "Não foi encontrada uma coluna compatível em $($Table.Schema).$($Table.Name) (procurou por: $($Candidates -join ', ')). Colunas disponíveis: $allColumnNames"
    }
    return $null
}

function Q([string]$Name) { return "[" + $Name.Replace("]", "]]") + "]" }
function Table-Q($Table) { return "$(Q $Table.Schema).$(Q $Table.Name)" }
function Column-OrNull($Column, [string]$Alias) {
    if ($Column) { return "$(Q $Column) AS $(Q $Alias)" }
    return "NULL AS $(Q $Alias)"
}

function Read-CodeDescriptionTable(
    [string[]]$TableCandidates,
    [string[]]$CodeCandidates,
    [string[]]$DescriptionCandidates,
    [string]$Label
) {
    $table = Find-Table $TableCandidates
    if (-not $table) {
        $script:warnings.Add("${Label}: tabela não encontrada.")
        return @()
    }
    try {
        $code = Find-Column $table $CodeCandidates
        $description = Find-Column $table $DescriptionCandidates
        $rows = Invoke-Select "SELECT DISTINCT $(Q $code) AS code, $(Q $description) AS description FROM $(Table-Q $table) WITH (NOLOCK) WHERE $(Q $code) IS NOT NULL"
        return @($rows.Rows | ForEach-Object {
            [pscustomobject]@{ code = [string]$_.code; description = [string]$_.description }
        })
    }
    catch {
        $script:warnings.Add("${Label}: $($_.Exception.Message)")
        return @()
    }
}

try {
    $connection.Open()
    $warnings = [System.Collections.Generic.List[string]]::new()
    [Console]::Error.WriteLine("Ligação aberta. A localizar tabelas...")

    if ($Mode -eq "Health") {
        $probe = Invoke-Select "SELECT @@SERVERNAME AS ServerName, DB_NAME() AS DatabaseName"
        [pscustomobject]@{
            server = [string]$probe.Rows[0].ServerName
            database = [string]$probe.Rows[0].DatabaseName
        } | ConvertTo-Json -Compress
        exit 0
    }

    $customerTable = Find-Table @("Clientes", "Cliente")
    $supplierTable = Find-Table @("Fornecedores", "Fornecedor")
    # A "conta corrente" de cada cliente/fornecedor não é um campo direto na ficha — é montada a
    # partir de um template configurado por exercício (ExerciciosCBL.ContaForXX/ContaCliXX, ex:
    # "2211D????") + o sufixo de 4 dígitos específico da entidade (CnfTabLigCBL.Conta, Tabela=2
    # para Fornecedor / 1 para Cliente). "D" no template é o dígito de mercado (Nacional/UE/Outros).
    $cnfLigTable = Find-Table @("CnfTabLigCBL")
    $exerciciosCblTable = Find-Table @("ExerciciosCBL")

    function Resolve-AccountTemplate([int]$Year) {
        if (-not $exerciciosCblTable) { return $null }
        $col = Find-Column $exerciciosCblTable @("ContaFor01") $false
        if (-not $col) { return $null }
        $result = Invoke-Select "SELECT $(Q $col) AS tmpl FROM $(Table-Q $exerciciosCblTable) WITH (NOLOCK) WHERE Ano=@year" @{ "@year" = $Year }
        if ($result.Rows.Count -eq 0 -or $result.Rows[0].tmpl -is [DBNull]) { return $null }
        return [string]$result.Rows[0].tmpl
    }

    function Read-EntityPage($Table, [string]$CodeColumn, [string]$Type, [int]$Skip, [int]$Take, [string]$AccountTemplate, [int]$Year) {
        $code = Find-Column $Table @($CodeColumn, "Codigo", "Código")
        $name = Find-Column $Table @("Nome", "Descricao", "Descrição")
        $nif = Find-Column $Table @("NumContrib", "NumContribuinte", "NIF", "Contribuinte") $false
        $pais = Find-Column $Table @("Pais") $false
        $tabelaCode = if ($Type -eq "supplier") { 2 } else { 1 }

        $selectParts = @("e.$(Q $code) AS code", "e.$(Q $name) AS name")
        $selectParts += if ($nif) { "e.$(Q $nif) AS nif" } else { "NULL AS $(Q 'nif')" }
        $selectParts += if ($pais) { "e.$(Q $pais) AS pais" } else { "NULL AS $(Q 'pais')" }
        $joinSql = ""
        if ($AccountTemplate -and $cnfLigTable) {
            $selectParts += "l.Conta AS suffix"
            $joinSql = "LEFT JOIN $(Table-Q $cnfLigTable) l ON l.Entidade=e.$(Q $code) AND l.Tabela=@tabela AND l.Coluna=1 AND l.Ano=@year"
        } else {
            $selectParts += "NULL AS suffix"
        }

        $rows = Invoke-Select "SELECT $($selectParts -join ', ') FROM $(Table-Q $Table) e WITH (NOLOCK) $joinSql WHERE e.$(Q $code) IS NOT NULL ORDER BY e.$(Q $code) OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY" @{
            "@offset" = $Skip; "@limit" = $Take; "@tabela" = $tabelaCode; "@year" = $Year
        }
        $items = @($rows.Rows | ForEach-Object {
            $account = $null
            if ($AccountTemplate -and $_.suffix -isnot [DBNull]) {
                $suffix = ([string]$_.suffix).PadLeft(4, '0')
                $paisValue = if ($_.pais -is [DBNull]) { '' } else { [string]$_.pais }
                $marketDigit = if ($paisValue -eq '' -or $paisValue -eq 'PT') { '1' } else { '2' }
                $account = $AccountTemplate.Substring(0, 4) + $marketDigit + $suffix
            }
            [pscustomobject]@{
                code = [string]$_.code
                name = [string]$_.name
                nif = if ($_.nif -is [DBNull]) { $null } else { [string]$_.nif }
                account = $account
                keywords = $null
                type = $Type
            }
        })
        return [pscustomobject]@{
            items = $items
            nextOffset = $Skip + $items.Count
            hasMore = $items.Count -eq $Take
        }
    }

    if ($Mode -eq "Entities") {
        $table = if ($EntityType -eq "customer") { $customerTable } else { $supplierTable }
        if (-not $table) { throw "Tabela de $EntityType não encontrada." }
        [Console]::Error.WriteLine("A ler ${EntityType}: registos $Offset a $($Offset + $Limit)...")
        $accountTemplate = Resolve-AccountTemplate $Year
        Read-EntityPage $table $(if ($EntityType -eq "customer") { "Cliente" } else { "Fornecedor" }) $EntityType $Offset $Limit $accountTemplate $Year |
            ConvertTo-Json -Depth 5 -Compress
        exit 0
    }

    if ($Mode -eq "Ledger") {
        if (-not $Account) { throw "Indica a conta a consultar." }
        $movementsTable = Find-Table @("Movimentos", "MovimentosCG", "MovimentosContabilidade", "Lancamentos")
        if (-not $movementsTable) { throw "Tabela de movimentos contabilísticos não encontrada." }
        [Console]::Error.WriteLine("A ler movimentos da conta $Account entre $DateFrom e $DateTo...")

        $accountCol = Find-Column $movementsTable @("Conta", "ContaMovimento")
        $dateCol = Find-Column $movementsTable @("Data", "DataMovimento", "DataMov", "DataLanc", "DataLancamento") $false
        $dateExpr = $null
        if ($dateCol) {
            $dateExpr = Q $dateCol
        } else {
            $yearCol = Find-Column $movementsTable @("Ano") $false
            $monthCol = Find-Column $movementsTable @("Mes") $false
            $dayCol = Find-Column $movementsTable @("Dia") $false
            if ($yearCol -and $monthCol -and $dayCol) {
                $dateExpr = "TRY_CONVERT(date, CAST($(Q $yearCol) AS varchar(4)) + '-' + RIGHT('0' + CAST($(Q $monthCol) AS varchar(2)), 2) + '-' + RIGHT('0' + CAST($(Q $dayCol) AS varchar(2)), 2), 23)"
            } else {
                $allColumnsResult = Invoke-Select "SELECT c.name AS ColumnName FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name=@schema AND t.name=@table ORDER BY c.name" @{
                    "@schema" = $movementsTable.Schema; "@table" = $movementsTable.Name
                }
                $allColumnNames = @($allColumnsResult.Rows | ForEach-Object { $_.ColumnName }) -join ', '
                throw "Não foi encontrada uma coluna de data nem as colunas Ano/Mes/Dia em $($movementsTable.Schema).$($movementsTable.Name). Colunas disponíveis: $allColumnNames"
            }
        }
        $idCol = Find-Column $movementsTable @("Id", "IdMovimento") $false
        $descCol = Find-Column $movementsTable @("Descritivo", "Descricao", "Descrição", "DescritivoMovimento") $false
        $docCol = Find-Column $movementsTable @("Documento", "NumDocumento", "NDocumento") $false
        $debitCol = Find-Column $movementsTable @("ValorDebito", "Debito", "Débito") $false
        $creditCol = Find-Column $movementsTable @("ValorCredito", "Credito", "Crédito") $false
        $natureCol = $null
        $amountCol = $null
        if (-not ($debitCol -and $creditCol)) {
            $amountCol = Find-Column $movementsTable @("Valor", "Montante") $false
            $natureCol = Find-Column $movementsTable @("Natureza") $false
        }

        $selectParts = @(
            "$dateExpr AS data",
            "$(Column-OrNull $descCol 'descricao')",
            "$(Column-OrNull $docCol 'documento')",
            "$(Column-OrNull $idCol 'id')"
        )
        if ($debitCol -and $creditCol) {
            $selectParts += "$(Q $debitCol) AS debito"
            $selectParts += "$(Q $creditCol) AS credito"
        } elseif ($natureCol) {
            $selectParts += "$(Q $natureCol) AS natureza"
            $selectParts += "$(Column-OrNull $amountCol 'valor')"
        } else {
            $selectParts += "$(Column-OrNull $amountCol 'valor')"
        }

        $query = "SELECT $($selectParts -join ', ') FROM $(Table-Q $movementsTable) WITH (NOLOCK) WHERE $(Q $accountCol)=@account AND $dateExpr>=@dateFrom AND $dateExpr<=@dateTo ORDER BY $dateExpr"
        $rows = Invoke-Select $query @{ "@account" = $Account; "@dateFrom" = $DateFrom; "@dateTo" = $DateTo }

        $movements = @($rows.Rows | ForEach-Object {
            if ($debitCol -and $creditCol) {
                $debit = if ($_.debito -is [DBNull]) { 0 } else { [double]$_.debito }
                $credit = if ($_.credito -is [DBNull]) { 0 } else { [double]$_.credito }
            } elseif ($natureCol) {
                # A tabela só tem "Valor" (com sinal) e "Natureza" (o código real D/C). O sinal de
                # Valor não corresponde de forma fiável a Débito/Crédito — confiamos sempre na
                # Natureza explícita em vez de adivinhar pelo sinal.
                $valor = if ($_.valor -is [DBNull]) { 0 } else { [Math]::Abs([double]$_.valor) }
                $isDebit = ([string]$_.natureza).Trim().ToUpperInvariant() -eq 'D'
                $debit = if ($isDebit) { $valor } else { 0 }
                $credit = if ($isDebit) { 0 } else { $valor }
            } else {
                $valor = if ($_.valor -is [DBNull]) { 0 } else { [double]$_.valor }
                $debit = if ($valor -ge 0) { $valor } else { 0 }
                $credit = if ($valor -lt 0) { [Math]::Abs($valor) } else { 0 }
            }
            [pscustomobject]@{
                id = if ($_.id -is [DBNull] -or -not $idCol) { [Guid]::NewGuid().ToString() } else { [string]$_.id }
                date = ([DateTime]$_.data).ToString("yyyy-MM-dd")
                description = if ($_.descricao -is [DBNull]) { "" } else { [string]$_.descricao }
                reference = if ($_.documento -is [DBNull]) { "" } else { [string]$_.documento }
                debit = $debit
                credit = $credit
            }
        })

        $balanceSelect = if ($debitCol -and $creditCol) {
            "SUM(ISNULL($(Q $debitCol),0)) - SUM(ISNULL($(Q $creditCol),0))"
        } elseif ($natureCol) {
            "SUM(CASE WHEN UPPER(LTRIM(RTRIM($(Q $natureCol))))='D' THEN ABS(ISNULL($(Q $amountCol),0)) ELSE -ABS(ISNULL($(Q $amountCol),0)) END)"
        } else {
            "SUM(ISNULL($(Q $amountCol),0))"
        }
        $dateFromYear = [int]$DateFrom.Substring(0, 4)
        $openingWhere = if ($dateCol) {
            "$(Q $dateCol) < @dateFrom"
        } else {
            "(($(Q $yearCol) < @year) OR ($(Q $yearCol) = @year AND $(Q $monthCol) = 0) OR ($(Q $yearCol) = @year AND $(Q $monthCol) BETWEEN 1 AND 12 AND $dateExpr < @dateFrom))"
        }
        $openingQuery = "SELECT $balanceSelect AS saldo FROM $(Table-Q $movementsTable) WITH (NOLOCK) WHERE $(Q $accountCol)=@account AND $openingWhere"
        $openingResult = Invoke-Select $openingQuery @{ "@account" = $Account; "@dateFrom" = $DateFrom; "@year" = $dateFromYear }
        $openingBalance = if ($openingResult.Rows.Count -gt 0 -and $openingResult.Rows[0].saldo -isnot [DBNull]) { [double]$openingResult.Rows[0].saldo } else { 0.0 }

        [pscustomobject]@{ movements = $movements; openingBalance = $openingBalance } | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }

    $accountTable = Find-Table @("PlanoContas", "PlanoConta", "Contas")
    # "PlanoIva" (não "Iva") é a tabela que liga cada código de IVA à sua conta de IVA dedutível
    # (ContaIva) — a tabela "Iva" simples só tem o código/taxa, sem essa ligação contabilística.
    $vatTable = Find-Table @("PlanoIva", "Iva", "IVA", "TaxasIVA", "TaxasIva")

    if (-not $accountTable) { throw "Tabela do plano de contas não encontrada." }
    if (-not $vatTable) { throw "Tabela de IVA não encontrada." }

    [Console]::Error.WriteLine("A ler plano de contas...")
    $accountCode = Find-Column $accountTable @("Conta", "Codigo", "Código")
    $accountDescription = Find-Column $accountTable @("Descricao", "Descrição", "Nome")
    $accountYear = Find-Column $accountTable @("Ano", "Exercicio", "Exercício") $false
    $accountActive = Find-Column $accountTable @("Activo", "Ativo", "Estado") $false
    # ClasseIva liga a conta de gasto ao código de IVA correspondente em PlanoIva (ex: conta 6221
    # tem ClasseIva="2321", que tem ContaIva="2432121") — permite sugerir a conta de IVA a partir
    # da conta de gasto escolhida, sem o utilizador ter de a preencher à parte.
    $accountVatClass = Find-Column $accountTable @("ClasseIva", "ClasseIVA") $false
    $accountWhere = if ($accountYear) { " WHERE $(Q $accountYear)=@year" } else { "" }
    $accounts = Invoke-Select "SELECT $(Q $accountCode) AS code, $(Q $accountDescription) AS description, $(Column-OrNull $accountActive 'active'), $(Column-OrNull $accountVatClass 'vatClass') FROM $(Table-Q $accountTable) WITH (NOLOCK)$accountWhere" @{ "@year" = $Year }

    $vatCode = Find-Column $vatTable @("Iva", "IVA", "Codigo", "Código")
    [Console]::Error.WriteLine("A ler taxas de IVA...")
    $vatDescription = Find-Column $vatTable @("Descricao", "Descrição", "Nome")
    $vatRate = Find-Column $vatTable @("Taxa", "TaxaIva", "Percentagem", "Valor")
    $vatAccount = Find-Column $vatTable @("ContaIva", "Conta") $false
    $vatYear = Find-Column $vatTable @("Ano", "Exercicio", "Exercício") $false
    if ($vatYear) {
        # Pode não existir uma linha exatamente no ano corrente (ex: PlanoIva só atualizado há
        # anos) — escolhe, por código de IVA, o ano mais próximo do pedido (de preferência <=).
        $vatSelectInner = "SELECT $(Q $vatCode) AS code, $(Q $vatDescription) AS description, $(Q $vatRate) AS rate, $(Column-OrNull $vatAccount 'account'), ROW_NUMBER() OVER (PARTITION BY $(Q $vatCode) ORDER BY CASE WHEN $(Q $vatYear)<=@year THEN 0 ELSE 1 END, ABS($(Q $vatYear)-@year)) AS rn FROM $(Table-Q $vatTable) WITH (NOLOCK)"
        $vatRows = Invoke-Select "SELECT code, description, rate, account FROM ($vatSelectInner) t WHERE rn=1" @{ "@year" = $Year }
    } else {
        $vatRows = Invoke-Select "SELECT $(Q $vatCode) AS code, $(Q $vatDescription) AS description, $(Q $vatRate) AS rate, $(Column-OrNull $vatAccount 'account') FROM $(Table-Q $vatTable) WITH (NOLOCK)" @{}
    }
    $journals = Read-CodeDescriptionTable @("Diarios", "Diario", "CBLDiarios") @("Diario", "Codigo", "Código") @("Descricao", "Descrição", "Nome") "Diários"
    [Console]::Error.WriteLine("A procurar diários, documentos, exercícios, moedas e séries...")
    $documents = Read-CodeDescriptionTable @("DocumentosCBL", "DocumentosContabilidade", "Documentos", "Documento") @("Documento", "TipoDoc", "Codigo", "Código") @("Descricao", "Descrição", "Nome") "Documentos"
    $currencies = Read-CodeDescriptionTable @("Moedas", "Moeda") @("Moeda", "Codigo", "Código") @("Descricao", "Descrição", "Nome") "Moedas"
    $series = Read-CodeDescriptionTable @("Series", "Serie", "SeriesDocumentos") @("Serie", "Codigo", "Código") @("Descricao", "Descrição", "Nome") "Séries"

    $yearTable = Find-Table @("Exercicios", "Exercicio", "AnosContabilidade")
    $accountingYears = @()
    if ($yearTable) {
        try {
            $yearColumn = Find-Column $yearTable @("Ano", "Exercicio", "Exercício")
            $yearDescription = Find-Column $yearTable @("Descricao", "Descrição", "Nome") $false
            $yearRows = Invoke-Select "SELECT DISTINCT $(Q $yearColumn) AS year, $(Column-OrNull $yearDescription 'description') FROM $(Table-Q $yearTable) WITH (NOLOCK) WHERE $(Q $yearColumn) IS NOT NULL"
            $accountingYears = @($yearRows.Rows | ForEach-Object {
                [pscustomobject]@{
                    year = [int]$_.year
                    description = if ($_.description -is [DBNull]) { [string]$_.year } else { [string]$_.description }
                }
            })
        }
        catch { $warnings.Add("Exercícios: $($_.Exception.Message)") }
    }
    else {
        $warnings.Add("Exercícios: tabela não encontrada.")
    }

    [pscustomobject]@{
        accounts = @($accounts.Rows | ForEach-Object {
            [pscustomobject]@{
                code = [string]$_.code
                description = [string]$_.description
                active = if ($_.active -is [DBNull]) { $true } else { [bool]$_.active }
                vatClass = if ($_.vatClass -is [DBNull]) { $null } else { [string]$_.vatClass }
            }
        })
        customers = @()
        suppliers = @()
        vatRates = @($vatRows.Rows | ForEach-Object {
            [pscustomobject]@{
                code = [string]$_.code
                description = [string]$_.description
                rate = [double]$_.rate
                account = if ($_.account -is [DBNull]) { $null } else { [string]$_.account }
            }
        })
        journals = $journals
        documents = $documents
        accountingYears = $accountingYears
        currencies = $currencies
        series = $series
        warnings = @($warnings)
        syncedAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json -Depth 6 -Compress
}
finally {
    if ($connection.State -ne [System.Data.ConnectionState]::Closed) { $connection.Close() }
}
