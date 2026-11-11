$ErrorActionPreference = 'Stop'
$runId = [Guid]::NewGuid().ToString('N')
$name = "c4g-report-export-$runId"
$label = 'c4g.report-export-gate'
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
$created = $false

try {
    $env:C4G_REPORT_GATE_PG_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $env:POSTGRES_PASSWORD = $env:C4G_REPORT_GATE_PG_PASSWORD
    & docker run --detach --pull never --name $name --label "$label=$runId" --env POSTGRES_PASSWORD --env POSTGRES_USER=c4g_report_gate --env POSTGRES_DB=c4g_report_gate --publish 127.0.0.1::5432 postgres:17-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_POSTGRES_START_FAILED' }
    $created = $true

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker exec $name pg_isready -h 127.0.0.1 -U c4g_report_gate -d c4g_report_gate *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw 'ISOLATED_POSTGRES_NOT_READY' }

    $address = (& docker port $name 5432/tcp) -join ''
    if ($LASTEXITCODE -ne 0 -or $address -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'ISOLATED_POSTGRES_PORT_INVALID' }
    $env:C4G_REPORT_GATE_PG_PORT = $Matches[1]
    $env:C4G_HTTP_SQL_TEST = 'isolated-report'
    Push-Location (Join-Path $root 'backend')
    try {
        & node --test --test-name-pattern 'report|exports' test/httpBrowseSql.test.js
        if ($LASTEXITCODE -ne 0) { throw 'REPORT_EXPORT_POSTGRES_GATE_FAILED' }
    } finally { Pop-Location }
} finally {
    Remove-Item Env:POSTGRES_PASSWORD,Env:C4G_REPORT_GATE_PG_PASSWORD,Env:C4G_REPORT_GATE_PG_PORT,Env:C4G_HTTP_SQL_TEST -ErrorAction SilentlyContinue
    if ($created) {
        $labels = & docker inspect --format '{{json .Config.Labels}}' $name | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or $labels.$label -ne $runId) { throw 'ISOLATED_POSTGRES_OWNERSHIP_UNVERIFIED' }
        & docker rm --force --volumes $name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_POSTGRES_CLEANUP_FAILED' }
    }
}
