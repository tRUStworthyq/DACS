[CmdletBinding()]
param(
    [switch]$Start,
    [switch]$SeedOnly,
    [switch]$ExpectPii,
    [switch]$Chat,
    [string]$MinioUser = $(if ($env:MINIO_ROOT_USER) { $env:MINIO_ROOT_USER } else { 'minioadmin' }),
    [string]$MinioPassword = $(if ($env:MINIO_ROOT_PASSWORD) { $env:MINIO_ROOT_PASSWORD } else { 'minioadmin' })
)

$ErrorActionPreference = 'Stop'
$compose = Join-Path $PSScriptRoot '../infra/docker-compose.dev.yml'
$bucket = 'dacs-s3-smoke'
$sourceId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'
$core = 'http://127.0.0.1:8082'
$minio = 'http://127.0.0.1:9100'
$kafkaBinaries = '/opt/kafka/bin'

function Invoke-Curl {
    $result = & curl.exe --silent --show-error --fail --max-time 15 @args
    if ($LASTEXITCODE -ne 0) { throw "curl failed (exit $LASTEXITCODE)" }
    return $result
}

function Set-S3Object($Key, $Content, $Created, $Accessed = '') {
    $options = @('-H', "x-amz-meta-creation-time: $Created", '-H', 'Content-Type: text/plain; charset=utf-8')
    if ($Accessed) { $options += @('-H', "x-amz-meta-last-access-time: $Accessed") }
    Invoke-Curl --aws-sigv4 'aws:amz:us-east-1:s3' --user "${MinioUser}:$MinioPassword" `
        -X PUT @options --data-binary $Content "$minio/$bucket/$Key" | Out-Null
}

function Assert-Result($Condition, $Message) {
    if (-not $Condition) { throw $Message }
}

if ($Start) {
    $services = if ($SeedOnly) { @('minio') } else { @('core-db', 'core', 'agents', 'minio') }
    & docker compose -f $compose up -d --build --wait @services
    if ($LASTEXITCODE -ne 0) { throw 'Compose startup failed' }
}

Invoke-Curl "$minio/minio/health/ready" | Out-Null
$bucketStatus = & curl.exe --silent --show-error --max-time 15 --aws-sigv4 'aws:amz:us-east-1:s3' `
    --user "${MinioUser}:$MinioPassword" --head --output NUL --write-out '%{http_code}' "$minio/$bucket"
if ($LASTEXITCODE -ne 0) { throw 'Could not check the fixture bucket' }
if ($bucketStatus -eq '404') {
    Invoke-Curl --aws-sigv4 'aws:amz:us-east-1:s3' --user "${MinioUser}:$MinioPassword" `
        -X PUT "$minio/$bucket" | Out-Null
} else {
    Assert-Result ($bucketStatus -eq '200') "Checking the fixture bucket returned HTTP $bucketStatus"
}

$created = '2018-03-14T09:15:00Z'
$lastAccess = '2021-04-05T10:30:00Z'
$report = "Quarterly archive report. Inventory of licenses, contracts and shipment records.`n" * 8
Set-S3Object 'archive/report.txt' $report $created
Set-S3Object 'archive/backup/report-copy.txt' $report '2019-01-02T13:00:00Z' $lastAccess
Set-S3Object 'archive/report-revised.txt' ($report + 'Revision: one row corrected.') '2020-06-22T14:45:00Z'
Set-S3Object 'archive/inventory.csv' "id,quantity,contact`n100,7,synthetic@example.test`n101,12,`n" '2017-12-18T08:00:00Z'
foreach ($index in 1..48) {
    Set-S3Object ('archive/register/{0:D2}.txt' -f $index) "Legacy register entry $index" $created
}
Set-S3Object 'outside/ignored.txt' 'Outside the requested prefix.' $created

$audit = @(
    @{time = '2020-01-07T11:35:00Z'; api = @{name = 'GetObject'; bucket = $bucket; object = 'archive/report.txt'; statusCode = 200}},
    @{time = $lastAccess; api = @{name = 'GetObject'; bucket = $bucket; object = 'archive/report.txt'; statusCode = 206}},
    @{time = '2022-10-05T12:00:00Z'; api = @{name = 'GetObject'; bucket = $bucket; object = 'archive/report.txt'; statusCode = 403}}
)
# A file preserves JSON quotes when PowerShell 5.1 passes arguments to curl.exe.
$auditFile = [IO.Path]::GetTempFileName()
try {
    $audit | ForEach-Object { $_ | ConvertTo-Json -Depth 4 -Compress } | Set-Content -Encoding ascii $auditFile
    Invoke-Curl --aws-sigv4 'aws:amz:us-east-1:s3' --user "${MinioUser}:$MinioPassword" `
        -X PUT --data-binary "@$auditFile" "$minio/$bucket/audit/minio.jsonl" | Out-Null
} finally {
    Remove-Item -LiteralPath $auditFile
}
Write-Host "Seeded $bucket with 52 archive objects, one excluded object and an audit export."
if ($SeedOnly) { return }

# Core's aggregate health can report DOWN for unused dev integrations.
$coreStatus = '000'
$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    $coreStatus = & curl.exe --silent --max-time 3 --output NUL --write-out '%{http_code}' "$core/actuator/health"
    if ($coreStatus -in '200', '503') { break }
    Start-Sleep -Seconds 1
} while ([DateTime]::UtcNow -lt $deadline)
Assert-Result ($coreStatus -in '200', '503') 'Core HTTP endpoint is unavailable'


$tokenBody = 'grant_type=password&client_id=gateway&client_secret=dev-client-secret-local-only&username=testuser&password=testpass123'
$token = (Invoke-Curl --ssl-no-revoke --noproxy keycloak --resolve 'keycloak:8443:127.0.0.1' `
    --data $tokenBody 'https://keycloak:8443/realms/DACS/protocol/openid-connect/token' | ConvertFrom-Json).access_token
$headers = @{Authorization = "Bearer $token"}

$name = 'S3 smoke ' + [Guid]::NewGuid().ToString('N')
$config = @{
    endpoint = 'http://minio:9000'
    bucket = $bucket
    prefix = 'archive/'
    accessKey = $MinioUser
    secretKey = $MinioPassword
    auditLog = @{bucket = $bucket; key = 'audit/minio.jsonl'}
} | ConvertTo-Json -Depth 4 -Compress
$payload = @{name = $name; sourceId = $sourceId; config = $config} | ConvertTo-Json -Compress
$impl = Invoke-RestMethod -Method Post -Uri "$core/api/impls" -Headers $headers `
    -ContentType 'application/json' -Body $payload -TimeoutSec 20
$implId = $impl.id
if (-not $implId) {
    # The existing core INSERT may return an empty 201 response.
    $pageNumber = 0
    do {
        $page = Invoke-RestMethod -Uri "$core/api/impls/by-source/${sourceId}?page=$pageNumber" -Headers $headers -TimeoutSec 20
        $implId = ($page.content | Where-Object name -eq $name).id
        $pageNumber++
    } while (-not $implId -and -not $page.last)
}
Assert-Result $implId 'Core did not return or persist the smoke implementation'

try {
    $accepted = Invoke-WebRequest -UseBasicParsing -Method Post -Headers $headers `
        -Uri "$core/api/collect/$implId/run" -TimeoutSec 20
    Assert-Result ($accepted.StatusCode -eq 202) 'Core did not accept the collection request'

    $consumerLog = [IO.Path]::GetTempFileName()
    try {
        # The console reader signals the end of an idle topic as a timeout on stderr.
        $ErrorActionPreference = 'Continue'
        $lines = & docker compose -f $compose exec -T kafka "$kafkaBinaries/kafka-console-consumer.sh" `
            --bootstrap-server kafka:9092 --topic DACS_agent_response --from-beginning --timeout-ms 15000 2> $consumerLog
        $ErrorActionPreference = 'Stop'
        $messages = @($lines | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object id -eq $implId)
        if ($messages.Count -eq 0) { Get-Content -LiteralPath $consumerLog | Write-Host }
    } finally {
        $ErrorActionPreference = 'Stop'
        Remove-Item -LiteralPath $consumerLog
    }

    Assert-Result (($messages.status -join ',') -eq 'BATCH,BATCH,COMPLETED') `
        "Unexpected statuses: $($messages.status -join ', '). Errors: $($messages.error -join ', ')"
    Assert-Result (($messages.batchIndex -join ',') -eq '0,1,2') 'Unexpected batch indexes'
    Assert-Result ($messages[0].items.Count -eq 50 -and $messages[1].items.Count -eq 2 -and `
        $messages[2].items.Count -eq 0) 'Unexpected batch sizes'
    Assert-Result ($messages[0].requestId -and @($messages.requestId | Select-Object -Unique).Count -eq 1) `
        'Responses have inconsistent request IDs'

    $objects = @{}
    foreach ($message in $messages) {
        foreach ($item in $message.items) {
            $objects.Add($item.path, $item)
        }
    }
    Assert-Result ($objects.Count -eq 52 -and @($objects.Keys | Where-Object { $_ -notlike "s3://$bucket/archive/*" }).Count -eq 0) `
        'Missing objects or prefix filtering failed'
    $original = $objects["s3://$bucket/archive/report.txt"]
    $copy = $objects["s3://$bucket/archive/backup/report-copy.txt"]
    $revision = $objects["s3://$bucket/archive/report-revised.txt"]
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $expectedHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($report))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
    Assert-Result ($original.extension -eq 'txt' -and $original.sizeBytes -eq $report.Length -and $original.modificationTime) `
        'Unexpected report metadata'
    Assert-Result ($original.sha256 -eq $expectedHash -and $copy.sha256 -eq $expectedHash -and $revision.sha256 -ne $expectedHash) `
        'Unexpected SHA-256 values for the report, copy and revision'
    Assert-Result ($original.simhash -match '^[0-9a-f]{16}$' -and $copy.simhash -eq $original.simhash -and $revision.simhash -match '^[0-9a-f]{16}$') `
        'Unexpected SimHash values for the report, copy and revision'
    $distance = 0
    for ($i = 0; $i -lt 16; $i++) {
        $difference = [Convert]::ToInt32($original.simhash.Substring($i, 1), 16) `
            -bxor [Convert]::ToInt32($revision.simhash.Substring($i, 1), 16)
        while ($difference -ne 0) {
            $difference = $difference -band ($difference - 1)
            $distance++
        }
    }
    Assert-Result ($distance -le 12) "SimHash distance for the near duplicate is $distance"
    Assert-Result (([DateTimeOffset]$original.creationTime) -eq ([DateTimeOffset]$created) -and `
        ([DateTimeOffset]$copy.creationTime) -eq ([DateTimeOffset]'2019-01-02T13:00:00Z')) 'Fixture creation dates were not collected'
    Assert-Result (([DateTimeOffset]$original.lastAccessTime) -eq ([DateTimeOffset]$lastAccess) -and `
        ([DateTimeOffset]$copy.lastAccessTime) -eq ([DateTimeOffset]$lastAccess) -and `
        $original.accessStatistics.successfulReads -eq 2 -and $copy.accessStatistics.successfulReads -eq 0) `
        'Audit statistics or access dates are incorrect'

    $requestId = [Guid]$messages[0].requestId
    Assert-Result (($accepted.Content | ConvertFrom-Json).requestId -eq [string]$requestId) 'Run ID did not match the Kafka response'
    $batchSql = @"
SELECT string_agg(status || ':' || jsonb_array_length(items), ',' ORDER BY batch_index)
FROM agent_response_batches
WHERE request_id = '$requestId' AND implementation_id = '$implId';
"@
    $stored = ''
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $stored = & docker compose -f $compose exec -T core-db psql -X -U core -d core -v ON_ERROR_STOP=1 -At -c $batchSql
        if ($LASTEXITCODE -ne 0) { throw 'Could not query stored agent batches' }
        if ($stored -eq 'BATCH:50,BATCH:2,COMPLETED:0') { break }
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)
    Assert-Result ($stored -eq 'BATCH:50,BATCH:2,COMPLETED:0') "Unexpected batches in PostgreSQL: $stored"

    $metadataSql = @"
SELECT (item->>'sha256') || ':' || (item->'accessStatistics'->>'successfulReads')
FROM agent_response_batches b CROSS JOIN LATERAL jsonb_array_elements(b.items) AS object(item)
WHERE b.request_id = '$requestId' AND item->>'path' = 's3://$bucket/archive/report.txt';
"@
    $storedMetadata = & docker compose -f $compose exec -T core-db psql -X -U core -d core -v ON_ERROR_STOP=1 -At -c $metadataSql
    Assert-Result ($LASTEXITCODE -eq 0 -and $storedMetadata -eq "${expectedHash}:2") 'Unexpected report metadata in PostgreSQL'

    $run = Invoke-RestMethod -Uri "$core/api/collect/runs/$requestId" -Headers $headers -TimeoutSec 20
    Assert-Result ($run.status -eq 'COMPLETED' -and $run.processed -eq 52) 'Unexpected run status'
    $scores = Invoke-RestMethod -Uri "$core/api/collect/runs/$requestId/aging?limit=100" -Headers $headers -TimeoutSec 20
    $duplicates = @($scores | Where-Object preferredPath)
    Assert-Result ($duplicates.Count -eq 2 -and @($duplicates.preferredPath | Select-Object -Unique).Count -eq 1) 'Exact duplicate group was not found'
    Assert-Result (@($scores | Where-Object status -eq 'INSUFFICIENT_DATA').Count -eq 52) 'Historical export without coverage was treated as evidence of inactivity'
    if ($ExpectPii) {
        $pii = Invoke-WebRequest -UseBasicParsing -Uri "$core/api/collect/runs/$requestId/objects?piiStatus=DETECTED" -Headers $headers -TimeoutSec 20
        $detected = ConvertFrom-Json -InputObject $pii.Content
        Assert-Result ($detected.Count -eq 1 -and $detected[0].pii.categories -contains 'EMAIL' -and $detected[0].pii.scan_complete) 'Expected one detected EMAIL'
        Assert-Result (!$pii.Content.Contains('synthetic@example.test')) 'Matched text leaked into Core response'
    }
    if ($Chat) {
        $chatData = @{content = 'S3 aging smoke test'} | ConvertTo-Json -Compress
        $testChat = Invoke-RestMethod -Method Post -Uri "$core/api/chats" -Headers $headers -ContentType 'application/json' -Body $chatData
        try {
            $question = @{content = 'Call scoreFiles once with offset 0 and limit 1. Reply in one short sentence including the exact S3 path and aging status.'; requestId = $requestId} | ConvertTo-Json -Compress
            Invoke-RestMethod -Method Post -Uri "$core/api/chats/$($testChat.id)/messages" -Headers $headers -ContentType 'application/json' -Body $question -TimeoutSec 190 | Out-Null
            $messages = Invoke-RestMethod -Uri "$core/api/chats/$($testChat.id)/messages" -Headers $headers
            $agent = $messages.items | Where-Object role -eq 'AGENT' | Select-Object -First 1
            Assert-Result ($agent -and $agent.content.Contains("s3://$bucket/archive/")) 'Agent did not reference the attached scoring results'
        } finally {
            Invoke-RestMethod -Method Delete -Uri "$core/api/chats/$($testChat.id)" -Headers $headers | Out-Null
        }
    }

    Write-Host "PASS: core -> Kafka -> agents -> MinIO -> Kafka -> PostgreSQL. Request $requestId, 52 objects, two batches."
} finally {
    Invoke-RestMethod -Method Delete -Uri "$core/api/impls/$implId" -Headers $headers -TimeoutSec 20 | Out-Null
}
