param(
    [ValidateSet("Health", "Sync", "Entities", "Ledger", "Purchases", "IntrastatSales")]
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
    [string]$DateTo = "",
    [string]$DocumentTypes = ""
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

function Aliased-Column-OrNull([string]$TableAlias, $Column, [string]$Alias) {
    if ($Column) { return "$TableAlias.$(Q $Column) AS $(Q $Alias)" }
    return "NULL AS $(Q $Alias)"
}

function Json-Number([double]$Value) { return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture) }

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

        # ROW_NUMBER funciona desde o SQL Server 2005. OFFSET/FETCH só existe a partir de 2012
        # e falha em instalações Primavera antigas ou bases com compatibilidade anterior.
        $pagedSelect = "$($selectParts -join ', '), ROW_NUMBER() OVER (ORDER BY e.$(Q $code)) AS __rowNumber"
        $rows = Invoke-Select "SELECT * FROM (SELECT $pagedSelect FROM $(Table-Q $Table) e WITH (NOLOCK) $joinSql WHERE e.$(Q $code) IS NOT NULL) page WHERE page.__rowNumber>@offset AND page.__rowNumber<=(@offset+@limit) ORDER BY page.__rowNumber" @{
            "@offset" = $Skip; "@limit" = $Take; "@tabela" = $tabelaCode; "@year" = $Year
        }
        $items = @($rows.Rows | ForEach-Object {
            $account = $null
            if ($AccountTemplate -and $_.suffix -isnot [DBNull]) {
                $suffix = ([string]$_.suffix).Trim()
                $paisValue = if ($_.pais -is [DBNull]) { '' } else { [string]$_.pais }
                $marketDigit = if ($paisValue -eq '' -or $paisValue -eq 'PT') { '1' } else { '2' }
                # O placeholder do dígito de mercado varia por instalação. Os SAF-T da HELBOR
                # mostram ContaFor01="221S1????" (S), enquanto outras instalações usam D.
                # Substitui o placeholder e exatamente o número de ? configurado. Algumas bases
                # guardam CnfTabLigCBL.Conta com um zero inicial adicional (090218), apesar de o
                # template ter apenas cinco posições e a conta real ser 2211190218; inserir o
                # sufixo inteiro produzia incorretamente 22111090218.
                $resolvedTemplate = $AccountTemplate.Replace('S', $marketDigit).Replace('D', $marketDigit)
                $placeholderMatch = [regex]::Match($resolvedTemplate, '\?+$')
                if ($placeholderMatch.Success) {
                    $placeholderLength = $placeholderMatch.Length
                    $accountSuffix = $suffix.PadLeft($placeholderLength, '0')
                    if ($accountSuffix.Length -gt $placeholderLength) {
                        $accountSuffix = $accountSuffix.Substring($accountSuffix.Length - $placeholderLength)
                    }
                    $account = [regex]::Replace($resolvedTemplate, '\?+$', $accountSuffix)
                }
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

    if ($Mode -eq "IntrastatSales") {
        if (-not $DateFrom -or -not $DateTo) { throw "Indica o período de vendas a consultar." }
        $requestedDocumentTypes = @($DocumentTypes.Split(',') | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ })
        if ($requestedDocumentTypes.Count -eq 0) { throw "Indica os tipos de documento de venda a consultar." }

        $headerTable = Find-Table @("CabecDoc", "CabecDocs", "CabecDocumentosVenda", "VndCabecDoc")
        $lineTable = Find-Table @("LinhasDoc", "LinhaDoc", "LinhasDocumentosVenda", "VndLinhasDoc")
        $articleTable = Find-Table @("Artigo", "Artigos")
        if (-not $headerTable) { throw "Tabela de cabeçalhos de vendas não encontrada (CabecDoc)." }
        if (-not $lineTable) { throw "Tabela de linhas de vendas não encontrada (LinhasDoc)." }

        [Console]::Error.WriteLine("A ler vendas Intrastat entre $DateFrom e $DateTo...")
        $headerId = Find-Column $headerTable @("Id", "ID", "IdCabecDoc", "Chave")
        $headerDate = Find-Column $headerTable @("Data", "DataDoc", "DataDocumento")
        $headerType = Find-Column $headerTable @("TipoDoc", "Documento", "TipoDocumento")
        $headerSeries = Find-Column $headerTable @("Serie", "Série") $false
        $headerNumber = Find-Column $headerTable @("NumDoc", "NumeroDoc", "NúmeroDoc", "NumDocumento") $false
        $headerCustomerCode = Find-Column $headerTable @("Entidade", "Cliente", "CodCliente", "CodigoCliente")
        $headerEntityType = Find-Column $headerTable @("TipoEntidade", "TipoTerceiro") $false
        $headerCustomerName = Find-Column $headerTable @("Nome", "NomeEntidade", "NomeCliente") $false
        $headerTaxId = Find-Column $headerTable @("NumContribuinte", "NumContrib", "NIF", "Contribuinte") $false
        $headerCountry = Find-Column $headerTable @("Pais", "País", "PaisEntrega", "PaisDestino") $false
        $headerCancelled = Find-Column $headerTable @("Anulado", "Anulada", "Cancelado", "Cancelada") $false

        $lineHeaderId = Find-Column $lineTable @("IdCabecDoc", "IdCabecalho", "IdDocumento", "IdCabec")
        $lineNumber = Find-Column $lineTable @("NumLinha", "NumeroLinha", "NúmeroLinha", "Linha") $false
        $lineArticleCode = Find-Column $lineTable @("Artigo", "CodArtigo", "CodigoArtigo") $false
        $lineDescription = Find-Column $lineTable @("Descricao", "Descrição", "DescArtigo") $false
        $lineQuantity = Find-Column $lineTable @("Quantidade", "Qtd", "QuantidadeBase")
        $lineUnit = Find-Column $lineTable @("Unidade", "UnidadeBase", "CodUnidade") $false
        $lineGross = Find-Column $lineTable @("TotalIliquido", "TotalBruto", "ValorBruto") $false
        $lineDiscount = Find-Column $lineTable @("TotalDesconto", "ValorDesconto", "Desconto") $false
        $lineNet = Find-Column $lineTable @("TotalLiquido", "TotalLiq", "ValorLiquido") $false
        $lineUnitNet = Find-Column $lineTable @("PrecoLiquido", "PreçoLiquido", "PrecLiquido") $false
        $lineTax = Find-Column $lineTable @("TotalIva", "ValorIva", "IVA") $false
        if (-not $lineNet -and -not $lineUnitNet -and -not $lineGross) {
            throw "Não foi encontrado um valor líquido ou ilíquido nas linhas de vendas."
        }

        $customerCode = $null
        $customerName = $null
        $customerTaxId = $null
        $customerCountry = $null
        $customerJoin = ""
        if ($customerTable) {
            $customerCode = Find-Column $customerTable @("Cliente", "Codigo", "Código")
            $customerName = Find-Column $customerTable @("Nome", "Descricao", "Descrição") $false
            $customerTaxId = Find-Column $customerTable @("NumContrib", "NumContribuinte", "NIF", "Contribuinte") $false
            $customerCountry = Find-Column $customerTable @("Pais", "País") $false
            $customerJoin = "LEFT JOIN $(Table-Q $customerTable) c WITH (NOLOCK) ON c.$(Q $customerCode)=h.$(Q $headerCustomerCode)"
        } else {
            $warnings.Add("Clientes: tabela não encontrada; serão usados apenas os dados do documento.")
        }

        $articleCode = $null
        $articleDescription = $null
        $articleUnit = $null
        $articleCustoms = $null
        $articleOrigin = $null
        $articleWeightGsm = $null
        $articleWeightPerUnit = $null
        $articleWidth = $null
        $articleJoin = ""
        if ($articleTable -and $lineArticleCode) {
            $articleCode = Find-Column $articleTable @("Artigo", "Codigo", "Código")
            $articleDescription = Find-Column $articleTable @("Descricao", "Descrição", "Nome") $false
            $articleUnit = Find-Column $articleTable @("UnidadeBase", "Unidade", "CodUnidade") $false
            $articleCustoms = Find-Column $articleTable @("CodigoPautal", "CódigoPautal", "CodPautal", "Pauta", "CodigoAduaneiro", "NC", "CDU_CodigoPautal", "CDU_CodPautal") $false
            $articleOrigin = Find-Column $articleTable @("PaisOrigem", "PaísOrigem", "Origem", "CDU_PaisOrigem") $false
            $articleWeightGsm = Find-Column $articleTable @("Gramagem", "PesoM2", "PesoMetroQuadrado", "CDU_Gramagem") $false
            $articleWeightPerUnit = Find-Column $articleTable @("PesoUnitario", "PesoLiquido", "Peso", "CDU_PesoUnitario") $false
            $articleWidth = Find-Column $articleTable @("LarguraM", "Largura", "CDU_Largura") $false
            $articleJoin = "LEFT JOIN $(Table-Q $articleTable) a WITH (NOLOCK) ON a.$(Q $articleCode)=l.$(Q $lineArticleCode)"
        } else {
            $warnings.Add("Artigos: tabela ou código de artigo não encontrado; os dados aduaneiros serão completados no Intrastat Office.")
        }

        $customerNameExpressions = [System.Collections.Generic.List[string]]::new()
        if ($headerCustomerName) { $customerNameExpressions.Add("h.$(Q $headerCustomerName)") }
        if ($customerName) { $customerNameExpressions.Add("c.$(Q $customerName)") }
        $customerNameExpression = if ($customerNameExpressions.Count -gt 1) { "COALESCE($($customerNameExpressions -join ', ')) AS customerName" } elseif ($customerNameExpressions.Count -eq 1) { "$($customerNameExpressions[0]) AS customerName" } else { "NULL AS customerName" }

        $taxExpressions = [System.Collections.Generic.List[string]]::new()
        if ($headerTaxId) { $taxExpressions.Add("h.$(Q $headerTaxId)") }
        if ($customerTaxId) { $taxExpressions.Add("c.$(Q $customerTaxId)") }
        $taxExpression = if ($taxExpressions.Count -gt 1) { "COALESCE($($taxExpressions -join ', ')) AS customerTaxId" } elseif ($taxExpressions.Count -eq 1) { "$($taxExpressions[0]) AS customerTaxId" } else { "NULL AS customerTaxId" }

        $countryExpressions = [System.Collections.Generic.List[string]]::new()
        if ($headerCountry) { $countryExpressions.Add("h.$(Q $headerCountry)") }
        if ($customerCountry) { $countryExpressions.Add("c.$(Q $customerCountry)") }
        $countryExpression = if ($countryExpressions.Count -gt 1) { "COALESCE($($countryExpressions -join ', ')) AS customerCountry" } elseif ($countryExpressions.Count -eq 1) { "$($countryExpressions[0]) AS customerCountry" } else { "NULL AS customerCountry" }

        $descriptionExpressions = [System.Collections.Generic.List[string]]::new()
        if ($lineDescription) { $descriptionExpressions.Add("l.$(Q $lineDescription)") }
        if ($articleDescription) { $descriptionExpressions.Add("a.$(Q $articleDescription)") }
        $descriptionExpression = if ($descriptionExpressions.Count -gt 1) { "COALESCE($($descriptionExpressions -join ', ')) AS articleDescription" } elseif ($descriptionExpressions.Count -eq 1) { "$($descriptionExpressions[0]) AS articleDescription" } else { "NULL AS articleDescription" }

        $unitExpressions = [System.Collections.Generic.List[string]]::new()
        if ($lineUnit) { $unitExpressions.Add("l.$(Q $lineUnit)") }
        if ($articleUnit) { $unitExpressions.Add("a.$(Q $articleUnit)") }
        $unitExpression = if ($unitExpressions.Count -gt 1) { "COALESCE($($unitExpressions -join ', ')) AS unitMeasure" } elseif ($unitExpressions.Count -eq 1) { "$($unitExpressions[0]) AS unitMeasure" } else { "NULL AS unitMeasure" }

        if ($lineNet) {
            $netExpression = "l.$(Q $lineNet)"
        } elseif ($lineUnitNet) {
            # Nesta instalação PrecoLiquido já representa o total líquido da linha.
            $netExpression = "l.$(Q $lineUnitNet)"
        } elseif ($lineDiscount) {
            $netExpression = "l.$(Q $lineGross) - ISNULL(l.$(Q $lineDiscount), 0)"
        } else {
            $netExpression = "l.$(Q $lineGross)"
        }
        $grossExpression = if ($lineGross) { "l.$(Q $lineGross)" } else { $netExpression }

        $selectParts = @(
            "h.$(Q $headerId) AS headerId",
            "h.$(Q $headerDate) AS documentDate",
            "h.$(Q $headerType) AS documentType",
            "$(Aliased-Column-OrNull 'h' $headerSeries 'documentSeries')",
            "$(Aliased-Column-OrNull 'h' $headerNumber 'documentNumber')",
            "h.$(Q $headerCustomerCode) AS customerCode",
            $customerNameExpression,
            $taxExpression,
            $countryExpression,
            "$(Aliased-Column-OrNull 'h' $headerEntityType 'entityType')",
            "$(Aliased-Column-OrNull 'h' $headerCancelled 'cancelled')",
            "$(Aliased-Column-OrNull 'l' $lineNumber 'lineNumber')",
            "$(Aliased-Column-OrNull 'l' $lineArticleCode 'articleCode')",
            $descriptionExpression,
            "l.$(Q $lineQuantity) AS quantity",
            $unitExpression,
            "$grossExpression AS grossValue",
            "$(Aliased-Column-OrNull 'l' $lineDiscount 'discountValue')",
            "$netExpression AS netValue",
            "$(Aliased-Column-OrNull 'l' $lineTax 'taxValue')",
            "$(Aliased-Column-OrNull 'a' $articleCustoms 'customsCode')",
            "$(Aliased-Column-OrNull 'a' $articleOrigin 'originCountry')",
            "$(Aliased-Column-OrNull 'a' $articleWeightGsm 'weightGsm')",
            "$(Aliased-Column-OrNull 'a' $articleWeightPerUnit 'weightPerUnit')",
            "$(Aliased-Column-OrNull 'a' $articleWidth 'widthM')"
        )

        $queryParameters = @{ "@dateFrom" = $DateFrom; "@dateTo" = $DateTo }
        $docTypeParameters = [System.Collections.Generic.List[string]]::new()
        for ($index = 0; $index -lt $requestedDocumentTypes.Count; $index += 1) {
            $parameterName = "@docType$index"
            $queryParameters[$parameterName] = $requestedDocumentTypes[$index]
            $docTypeParameters.Add($parameterName)
        }
        $orderParts = @("h.$(Q $headerDate)", "h.$(Q $headerType)")
        if ($headerSeries) { $orderParts += "h.$(Q $headerSeries)" }
        if ($headerNumber) { $orderParts += "h.$(Q $headerNumber)" }
        if ($lineNumber) { $orderParts += "l.$(Q $lineNumber)" }
        $query = "SELECT $($selectParts -join ', ') FROM $(Table-Q $headerTable) h WITH (NOLOCK) INNER JOIN $(Table-Q $lineTable) l WITH (NOLOCK) ON l.$(Q $lineHeaderId)=h.$(Q $headerId) $customerJoin $articleJoin WHERE h.$(Q $headerDate)>=@dateFrom AND h.$(Q $headerDate)<DATEADD(day, 1, @dateTo) AND UPPER(LTRIM(RTRIM(h.$(Q $headerType)))) IN ($($docTypeParameters -join ', ')) ORDER BY $($orderParts -join ', ')"
        $rows = Invoke-Select $query $queryParameters

        $salesLines = [System.Collections.Generic.List[object]]::new()
        $documentKeys = [System.Collections.Generic.HashSet[string]]::new()
        $typeCounts = @{}
        $sourceRowNo = 0
        foreach ($row in $rows.Rows) {
            $cancelled = if ($row.cancelled -is [DBNull]) { "" } else { ([string]$row.cancelled).Trim().ToUpperInvariant() }
            if ($cancelled -in @("1", "-1", "TRUE", "T", "SIM", "S", "ANULADO", "CANCELADO")) { continue }
            $rowEntityType = if ($row.entityType -is [DBNull]) { "" } else { ([string]$row.entityType).Trim().ToUpperInvariant() }
            if ($rowEntityType -and $rowEntityType -notin @("C", "CLIENTE")) { continue }

            $sourceRowNo += 1
            $documentType = ([string]$row.documentType).Trim().ToUpperInvariant()
            $documentSeries = if ($row.documentSeries -is [DBNull]) { "" } else { ([string]$row.documentSeries).Trim() }
            $documentNumber = if ($row.documentNumber -is [DBNull]) { "" } else { ([string]$row.documentNumber).Trim() }
            $documentRefParts = @($documentType)
            if ($documentSeries) { $documentRefParts += $documentSeries }
            if ($documentNumber) { $documentRefParts += $documentNumber }
            $documentRef = $documentRefParts -join '/'
            $isNewDocument = $documentKeys.Add([string]$row.headerId)
            if ($isNewDocument) {
                $typeCounts[$documentType] = 1 + [int]($typeCounts[$documentType])
            }

            $isCredit = $documentType -match '^(NC|N/C|CN|CRED|DEV)'
            $quantity = if ($row.quantity -is [DBNull]) { 0.0 } else { [double]$row.quantity }
            $grossValue = if ($row.grossValue -is [DBNull]) { 0.0 } else { [double]$row.grossValue }
            $discountValue = if ($row.discountValue -is [DBNull]) { 0.0 } else { [double]$row.discountValue }
            $netValue = if ($row.netValue -is [DBNull]) { 0.0 } else { [double]$row.netValue }
            $taxValue = if ($row.taxValue -is [DBNull]) { 0.0 } else { [double]$row.taxValue }
            if ($isCredit) {
                $quantity = -[Math]::Abs($quantity)
                $grossValue = -[Math]::Abs($grossValue)
                $discountValue = -[Math]::Abs($discountValue)
                $netValue = -[Math]::Abs($netValue)
                $taxValue = -[Math]::Abs($taxValue)
            }

            $salesLines.Add([pscustomobject]@{
                sourceRowNo = $sourceRowNo
                documentDate = ([DateTime]$row.documentDate).ToString("yyyy-MM-dd")
                documentType = $documentType
                documentSeries = $documentSeries
                documentNumber = $documentNumber
                invoiceRef = $documentRef
                customerCode = if ($row.customerCode -is [DBNull]) { $null } else { [string]$row.customerCode }
                customerName = if ($row.customerName -is [DBNull]) { $null } else { [string]$row.customerName }
                customerTaxId = if ($row.customerTaxId -is [DBNull]) { $null } else { [string]$row.customerTaxId }
                customerCountry = if ($row.customerCountry -is [DBNull]) { $null } else { [string]$row.customerCountry }
                articleCode = if ($row.articleCode -is [DBNull]) { $null } else { [string]$row.articleCode }
                articleDescription = if ($row.articleDescription -is [DBNull]) { $null } else { [string]$row.articleDescription }
                quantity = $quantity
                unitMeasure = if ($row.unitMeasure -is [DBNull]) { $null } else { [string]$row.unitMeasure }
                grossValue = $grossValue
                discountValue = $discountValue
                netValue = $netValue
                taxValue = $taxValue
                customsCode = if ($row.customsCode -is [DBNull]) { $null } else { [string]$row.customsCode }
                originCountry = if ($row.originCountry -is [DBNull]) { $null } else { [string]$row.originCountry }
                weightGsm = if ($row.weightGsm -is [DBNull]) { $null } else { [double]$row.weightGsm }
                weightPerUnit = if ($row.weightPerUnit -is [DBNull]) { $null } else { [double]$row.weightPerUnit }
                widthM = if ($row.widthM -is [DBNull]) { $null } else { [double]$row.widthM }
            })
        }

        [pscustomobject]@{
            lines = @($salesLines)
            documents = $documentKeys.Count
            documentTypes = $typeCounts
            requestedDocumentTypes = $requestedDocumentTypes
            warnings = @($warnings)
            syncedAt = [DateTime]::UtcNow.ToString("o")
        } | ConvertTo-Json -Depth 6 -Compress
        exit 0
    }

    if ($Mode -eq "Ledger" -or $Mode -eq "Purchases") {
        if ($Mode -eq "Ledger" -and -not $Account) { throw "Indica a conta a consultar." }
        $movementsTable = Find-Table @("Movimentos", "MovimentosCG", "MovimentosContabilidade", "Lancamentos")
        if (-not $movementsTable) { throw "Tabela de movimentos contabilísticos não encontrada." }
        if ($Mode -eq "Purchases") {
            [Console]::Error.WriteLine("A ler movimentos contabilísticos para confirmar compras entre $DateFrom e $DateTo...")
        } else {
            [Console]::Error.WriteLine("A ler movimentos da conta $Account entre $DateFrom e $DateTo...")
        }

        $accountCol = Find-Column $movementsTable @("Conta", "ContaMovimento")
        $dateCol = Find-Column $movementsTable @("Data", "DataMovimento", "DataMov", "DataLanc", "DataLancamento") $false
        $yearCol = $null
        $monthCol = $null
        $dayCol = $null
        $dateExpr = $null
        if ($dateCol) {
            $dateExpr = Q $dateCol
        } else {
            $yearCol = Find-Column $movementsTable @("Ano") $false
            $monthCol = Find-Column $movementsTable @("Mes") $false
            $dayCol = Find-Column $movementsTable @("Dia") $false
            if ($yearCol -and $monthCol -and $dayCol) {
                # DATEADD existe nas versões antigas suportadas pelo ERP Evolution. Evita
                # TRY_CONVERT/DATEFROMPARTS, indisponíveis antes do SQL Server 2012 (ou quando
                # a base mantém um nível de compatibilidade mais antigo). Usada só para o SELECT
                # e o ORDER BY — o filtro por período usa Ano/Mes/Dia diretamente (ver
                # $dateWhere abaixo), para o SQL Server conseguir aproveitar índices existentes
                # em Ano em vez de percorrer a tabela inteira a calcular esta expressão linha a linha.
                $dateExpr = "DATEADD(day, CAST($(Q $dayCol) AS int)-1, DATEADD(month, CAST($(Q $monthCol) AS int)-1, DATEADD(year, CAST($(Q $yearCol) AS int)-1900, 0)))"
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
        $journalCol = Find-Column $movementsTable @("Diario", "Diário", "CodDiario", "Journal") $false
        $postingNumberCol = Find-Column $movementsTable @("NumDiario", "NumeroDiario", "NúmeroDiário", "NumLancamento", "NumeroLancamento", "Lancamento") $false
        # Prefere a referência da fatura do fornecedor ao número interno do lançamento.
        $docCol = Find-Column $movementsTable @("DocExterno", "DocumentoExterno", "Referencia", "Referência", "RefDocumento", "NumDocExterno", "NumeroDocExterno", "Documento", "NumDocumento", "NDocumento") $false
        # Mesmo quando uma compra é lançada diretamente no banco (sem conta 22/27), o movimento
        # pode conservar o terceiro nos campos TipoEntidade/Entidade. A aplicação resolve este
        # código contra a ficha de fornecedor sincronizada e confirma assim o NIF.
        $entityTypeCol = Find-Column $movementsTable @("TipoEntidade", "Tipo Entidade", "TipoTerceiro", "TipoEnt", "TEntidade") $false
        $entityCodeCol = Find-Column $movementsTable @("Entidade", "CodEntidade", "CodigoEntidade", "CódigoEntidade", "Terceiro") $false
        $debitCol = Find-Column $movementsTable @("ValorDebito", "Debito", "Débito") $false
        $creditCol = Find-Column $movementsTable @("ValorCredito", "Credito", "Crédito") $false
        $natureCol = $null
        $amountCol = $null
        if (-not ($debitCol -and $creditCol)) {
            $amountCol = Find-Column $movementsTable @("Valor", "Montante") $false
            $natureCol = Find-Column $movementsTable @("Natureza") $false
        }

        $selectParts = @(
            "$(Q $accountCol) AS conta",
            "$dateExpr AS data",
            "$(Column-OrNull $descCol 'descricao')",
            "$(Column-OrNull $docCol 'documento')",
            "$(Column-OrNull $idCol 'id')",
            "$(Column-OrNull $journalCol 'diario')",
            "$(Column-OrNull $postingNumberCol 'numLancamento')",
            "$(Column-OrNull $entityTypeCol 'tipoEntidade')",
            "$(Column-OrNull $entityCodeCol 'entidade')"
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

        $accountWhere = if ($Mode -eq "Purchases") { "1=1" } else { "$(Q $accountCol)=@account" }
        $queryParameters = if ($Mode -eq "Purchases") {
            @{ "@dateFrom" = $DateFrom; "@dateTo" = $DateTo }
        } else {
            @{ "@account" = $Account; "@dateFrom" = $DateFrom; "@dateTo" = $DateTo }
        }
        if ($yearCol -and $monthCol -and $dayCol) {
            # Comparação direta em Ano/Mes/Dia (sem envolver as colunas em DATEADD) para o
            # otimizador conseguir usar os índices que começam por Ano em vez de um scan à
            # tabela toda — a versão anterior filtrava por $dateExpr, uma expressão calculada
            # que nenhum índice cobre, e isso demorava minutos numa tabela com milhões de linhas.
            $fromDate = [DateTime]::ParseExact($DateFrom, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
            $toDate = [DateTime]::ParseExact($DateTo, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
            $dateWhere = "(($(Q $yearCol)>@yearFrom) OR ($(Q $yearCol)=@yearFrom AND $(Q $monthCol)>@monthFrom) OR ($(Q $yearCol)=@yearFrom AND $(Q $monthCol)=@monthFrom AND $(Q $dayCol)>=@dayFrom)) AND (($(Q $yearCol)<@yearTo) OR ($(Q $yearCol)=@yearTo AND $(Q $monthCol)<@monthTo) OR ($(Q $yearCol)=@yearTo AND $(Q $monthCol)=@monthTo AND $(Q $dayCol)<=@dayTo))"
            $queryParameters["@yearFrom"] = $fromDate.Year
            $queryParameters["@monthFrom"] = $fromDate.Month
            $queryParameters["@dayFrom"] = $fromDate.Day
            $queryParameters["@yearTo"] = $toDate.Year
            $queryParameters["@monthTo"] = $toDate.Month
            $queryParameters["@dayTo"] = $toDate.Day
        } else {
            $dateWhere = "$dateExpr>=@dateFrom AND $dateExpr<=@dateTo"
        }
        $query = "SELECT $($selectParts -join ', ') FROM $(Table-Q $movementsTable) WITH (NOLOCK) WHERE $accountWhere AND $dateWhere ORDER BY $dateExpr"
        $rows = Invoke-Select $query $queryParameters

        # Para contas de compras isto pode devolver centenas de milhares de linhas (tabelas
        # Movimentos deste tamanho não são invulgares). O pipeline ForEach-Object + ConvertTo-Json
        # usado antes demorava minutos nesse volume — um foreach normal com escrita direta de
        # JSON evita a sobrecarga do pipeline e do serializador por reflexão da PowerShell.
        $movementsJson = [System.Text.StringBuilder]::new(1024)
        [void]$movementsJson.Append('[')
        $isFirstMovement = $true
        foreach ($row in $rows.Rows) {
            if ($debitCol -and $creditCol) {
                $debit = if ($row.debito -is [DBNull]) { 0 } else { [double]$row.debito }
                $credit = if ($row.credito -is [DBNull]) { 0 } else { [double]$row.credito }
            } elseif ($natureCol) {
                # A tabela só tem "Valor" (com sinal) e "Natureza" (o código real D/C). O sinal de
                # Valor não corresponde de forma fiável a Débito/Crédito — confiamos sempre na
                # Natureza explícita em vez de adivinhar pelo sinal.
                $valor = if ($row.valor -is [DBNull]) { 0 } else { [Math]::Abs([double]$row.valor) }
                $isDebit = ([string]$row.natureza).Trim().ToUpperInvariant() -eq 'D'
                $debit = if ($isDebit) { $valor } else { 0 }
                $credit = if ($isDebit) { 0 } else { $valor }
            } else {
                $valor = if ($row.valor -is [DBNull]) { 0 } else { [double]$row.valor }
                $debit = if ($valor -ge 0) { $valor } else { 0 }
                $credit = if ($valor -lt 0) { [Math]::Abs($valor) } else { 0 }
            }
            # Nota de performance: nada aqui pode chamar uma função PowerShell definida pelo
            # utilizador (nem sequer uma pequena) — testámos e uma única chamada a função dentro
            # deste ciclo, repetida 150 mil vezes, custa mais do que o ConvertTo-Json que estava a
            # substituir (140s vs 13s). Chamadas diretas a métodos .NET como .Replace()/.ToString()
            # não têm esse custo (2s para o mesmo volume), por isso o escape de JSON vai inline.
            $movId = if ($row.id -is [DBNull] -or -not $idCol) { [Guid]::NewGuid().ToString() } else { ([string]$row.id).Replace('\', '\\').Replace('"', '\"') }
            $movAccount = ([string]$row.conta).Trim().Replace('\', '\\').Replace('"', '\"')
            $movJournal = if ($row.diario -is [DBNull]) { "" } else { ([string]$row.diario).Replace('\', '\\').Replace('"', '\"') }
            $movPostingNumber = if ($row.numLancamento -is [DBNull]) { "" } else { ([string]$row.numLancamento).Replace('\', '\\').Replace('"', '\"') }
            $movDate = ([DateTime]$row.data).ToString("yyyy-MM-dd")
            $movDescription = if ($row.descricao -is [DBNull]) { "" } else { ([string]$row.descricao).Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t') }
            $movReference = if ($row.documento -is [DBNull]) { "" } else { ([string]$row.documento).Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t') }
            $movEntityType = if ($row.tipoEntidade -is [DBNull]) { "" } else { ([string]$row.tipoEntidade).Trim().Replace('\', '\\').Replace('"', '\"') }
            $movEntityCode = if ($row.entidade -is [DBNull]) { "" } else { ([string]$row.entidade).Trim().Replace('\', '\\').Replace('"', '\"') }

            if ($isFirstMovement) { $isFirstMovement = $false } else { [void]$movementsJson.Append(',') }
            [void]$movementsJson.Append('{"id":"').Append($movId).
                Append('","account":"').Append($movAccount).
                Append('","journal":"').Append($movJournal).
                Append('","postingNumber":"').Append($movPostingNumber).
                Append('","date":"').Append($movDate).
                Append('","description":"').Append($movDescription).
                Append('","reference":"').Append($movReference)
            # Não aumenta todas as centenas de milhares de linhas com duas propriedades vazias.
            if ($movEntityType -ne "") { [void]$movementsJson.Append('","entityType":"').Append($movEntityType) }
            if ($movEntityCode -ne "") { [void]$movementsJson.Append('","entityCode":"').Append($movEntityCode) }
            [void]$movementsJson.Append('","debit":').Append($debit.ToString([System.Globalization.CultureInfo]::InvariantCulture)).
                Append(',"credit":').Append($credit.ToString([System.Globalization.CultureInfo]::InvariantCulture)).
                Append('}')
        }
        [void]$movementsJson.Append(']')

        if ($Mode -eq "Purchases") {
            Write-Output "{`"movements`":$($movementsJson.ToString()),`"openingBalance`":0.0}"
            exit 0
        }

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

        Write-Output "{`"movements`":$($movementsJson.ToString()),`"openingBalance`":$(Json-Number $openingBalance)}"
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
