param([switch]$ReceiptRecovery)
$ErrorActionPreference='Stop'
$container="c4g-f12-gate-$PID"
$volume="c4g-f12-gate-volume-$PID"
$port=5547
$password=[Guid]::NewGuid().ToString('N')
$workspaceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$manifestPath=Join-Path $PSScriptRoot 'gate-programs.json'
$allowedCategories=@('functional-entrypoint','runner-harness','setup-authorized','migration-contract-probe','probe','benchmark')
$gateManifest=Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if($gateManifest.schemaVersion-ne 1-or-not $gateManifest.programs){throw 'F12 gate program manifest is invalid.'}
$ids=@{};$orders=@{}
foreach($program in $gateManifest.programs){
  if(-not $program.id-or-$ids.ContainsKey($program.id)-or-not($program.order-is [int])-or-$orders.ContainsKey([string]$program.order)){throw 'F12 gate program identity/order is invalid.'}
  $ids[$program.id]=$true;$orders[[string]$program.order]=$true
  if($program.category-notin $allowedCategories-or-not $program.phase-or-not $program.failure){throw 'F12 gate program classification is invalid.'}
  if($program.nodeArgs|Where-Object{$_-ne '--test'}){throw 'F12 gate Node option is not allowed.'}
  $resolved=[IO.Path]::GetFullPath((Join-Path $workspaceRoot $program.path))
  if(-not $resolved.StartsWith($workspaceRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)-or[IO.Path]::GetExtension($resolved)-notin @('.js','.cjs')-or-not(Test-Path -LiteralPath $resolved -PathType Leaf)){throw 'F12 gate program path is invalid.'}
}
function Invoke-GatePhase([string]$phase){
  $selected=@($gateManifest.programs|Where-Object{$_.phase-eq$phase}|Sort-Object order)
  if(-not $selected){throw "F12 gate phase is unknown: $phase"}
  foreach($program in $selected){
    $programPath=[IO.Path]::GetFullPath((Join-Path $workspaceRoot $program.path))
    $command=@($program.nodeArgs)+@($programPath)+@($program.args)
    & node @command
    if($LASTEXITCODE-ne 0){throw $program.failure}
  }
}
try {
  if ($port -in @(5432,5433)) { throw 'F12 gate port is forbidden.' }
  & docker run --detach --name $container --mount "type=volume,source=$volume,target=/var/lib/postgresql/data" --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
  if($LASTEXITCODE-ne 0){throw 'Could not create disposable F12 PostgreSQL 17 container.'}
  $ready=$false
  for($attempt=0;$attempt-lt 40;$attempt++){& docker exec $container pg_isready -U c4g_f12_admin -d postgres *> $null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
  if(-not $ready){throw 'Disposable F12 PostgreSQL did not become ready.'}
  $env:F12_GATE_URL="postgresql://c4g_f12_admin:$password@127.0.0.1:${port}/postgres"
  Invoke-GatePhase 'foundation'
  & docker restart $container | Out-Null
  for($attempt=0;$attempt-lt 40;$attempt++){& docker exec $container pg_isready -U c4g_f12_admin -d postgres *> $null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
  Invoke-GatePhase 'restart'
  Invoke-GatePhase 'identity'
  & docker exec $container psql -U c4g_f12_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE f12_synthetic_f9 ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  if($LASTEXITCODE-ne 0){throw 'F12/F9 isolated foundation database creation failed.'}
  $env:F9_TEST_DATABASE_URL="postgresql://c4g_f12_admin:$password@127.0.0.1:${port}/f12_synthetic_f9"
  Invoke-GatePhase 'f9-foundation'
  Remove-Item Env:F9_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  & docker exec $container psql -U c4g_f12_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE f12_synthetic_legacy ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  if($LASTEXITCODE-ne 0){throw 'F12/F9 legacy upgrade database creation failed.'}
  Invoke-GatePhase 'legacy'
  $env:F9_TEST_DATABASE_URL=$env:F12_GATE_URL.Replace('/postgres','/f12_synthetic_central')
  Invoke-GatePhase 'vertical-setup'
  Remove-Item Env:F9_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Invoke-GatePhase 'functional'
  if ($ReceiptRecovery) {
    Invoke-GatePhase 'receipt-recovery'
  }
  & docker inspect --format '{{index .RepoDigests 0}}' postgres:17-alpine
} finally {
  Remove-Item Env:F12_GATE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:F9_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  $knownContainer=& docker inspect --format '{{.Name}}' $container 2>$null
  if($knownContainer -eq "/$container"){& docker rm --force $container *> $null}
  $knownVolume=& docker volume inspect --format '{{.Name}}' $volume 2>$null
  if($knownVolume -eq $volume){& docker volume rm $volume *> $null}
}
