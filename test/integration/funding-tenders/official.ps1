$ErrorActionPreference='Stop'
$container="c4g-official-fixture-$PID"
$secret=[Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$secret" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=funding_fixture -p '127.0.0.1:5558:5432' postgres:17-alpine | Out-Null
  if($LASTEXITCODE-ne 0){throw 'Could not create official source disposable PostgreSQL.'}
  $ready=$false
  for($i=0;$i-lt 40;$i++){& docker exec $container pg_isready -U c4g_f12_admin -d funding_fixture *> $null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
  if(-not $ready){throw 'Fixture PostgreSQL not ready.'}
  $env:FUNDING_TEST_DATABASE_URL="postgresql://c4g_f12_admin:$secret@127.0.0.1:5558/funding_fixture"
  & node (Join-Path $PSScriptRoot 'official.js')
  if($LASTEXITCODE-ne 0){throw 'Official programme gate failed.'}
} finally {
  Remove-Item Env:FUNDING_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  & docker rm -f $container *> $null
}
