param([switch]$AuthorizeFivePublicRecords)
$ErrorActionPreference='Stop'
if(-not $AuthorizeFivePublicRecords){throw 'Requires explicit authorization: EU Funding & Tenders, at most five records, localhost:5560/funding_live_rehearsal.'}
$container="c4g-funding-live-rehearsal-$PID"
$secret=[Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$secret" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=funding_live_rehearsal -p '127.0.0.1:5560:5432' postgres:17-alpine | Out-Null
  if($LASTEXITCODE-ne 0){throw 'Could not create disposable rehearsal database.'}
  $ready=$false
  for($i=0;$i-lt 40;$i++){& docker exec $container pg_isready -U c4g_f12_admin -d funding_live_rehearsal *> $null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
  if(-not $ready){throw 'Rehearsal PostgreSQL not ready.'}
  $env:CENTRAL_DATABASE_URL="postgresql://c4g_f12_admin:$secret@127.0.0.1:5560/funding_live_rehearsal"
  $env:NODE_ENV='development';$env:FUNDING_TENDERS_RUNTIME='central';$env:FUNDING_TENDERS_SOURCE='live-rehearsal';$env:FUNDING_TENDERS_REHEARSAL_APPROVED='five-public-records'
  & node (Join-Path $PSScriptRoot 'rehearsal.js')
  if($LASTEXITCODE-ne 0){throw 'Rehearsal failed; no production destination was used.'}
} finally {
  Remove-Item Env:CENTRAL_DATABASE_URL,Env:NODE_ENV,Env:FUNDING_TENDERS_RUNTIME,Env:FUNDING_TENDERS_SOURCE,Env:FUNDING_TENDERS_REHEARSAL_APPROVED -ErrorAction SilentlyContinue
  & docker rm -f $container *> $null
}
