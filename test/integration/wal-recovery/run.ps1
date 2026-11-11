param([Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]+$')][string]$Report)
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$out=Join-Path $root "context/reviews/$Report"
if(Test-Path -LiteralPath $out){throw 'REPORT_ALREADY_EXISTS'}
New-Item -ItemType Directory -Path $out | Out-Null
$run=[Guid]::NewGuid().ToString('N');$name="c4g-wal-proof-$run";$created=$false
$oldPassword=$env:POSTGRES_PASSWORD
$result=@{status='FAIL';run=$run;checks=@();limitations=@('Synthetic single-cluster PostgreSQL recovery; no application schema, objects, production WAL, RPO or RTO claim.');cleanup='UNCONFIRMED'}
function Invoke-Docker { & docker @args; if($LASTEXITCODE -ne 0){throw 'DOCKER_COMMAND_FAILED'} }
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 Invoke-Docker run --detach --pull never --name $name --label "c4g.wal-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres postgres:18-alpine postgres -c wal_level=replica -c archive_mode=on -c 'archive_command=mkdir -p /tmp/c4g-wal && cp %p /tmp/c4g-wal/%f' | Out-Null
 $created=$true;$ready=$false
 for($i=0;$i -lt 60;$i++){& docker exec $name pg_isready -U proof_admin -d postgres *> $null;if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 500}
 if(-not $ready){throw 'POSTGRES_NOT_READY'}
 Invoke-Docker exec $name psql -U proof_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE TABLE public.proof_wal (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO public.proof_wal VALUES (1,'before_backup');" | Out-Null
 Invoke-Docker exec -u postgres $name pg_basebackup -U proof_admin -D /tmp/c4g-base -X fetch -c fast | Out-Null
 Invoke-Docker exec $name psql -U proof_admin -d postgres -v ON_ERROR_STOP=1 -c "INSERT INTO public.proof_wal VALUES (2,'before_target')" | Out-Null
 Invoke-Docker exec $name psql -U proof_admin -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_create_restore_point('c4g_target')" | Out-Null
 Invoke-Docker exec $name psql -U proof_admin -d postgres -v ON_ERROR_STOP=1 -c "INSERT INTO public.proof_wal VALUES (3,'after_target')" | Out-Null
 Invoke-Docker exec $name psql -U proof_admin -d postgres -v ON_ERROR_STOP=1 -c 'SELECT pg_switch_wal()' | Out-Null
 $archived=$false
 for($i=0;$i -lt 60;$i++) { $n=(& docker exec $name psql -U proof_admin -d postgres -At -c 'SELECT archived_count FROM pg_stat_archiver');if($LASTEXITCODE -eq 0 -and [int]$n -ge 2){$archived=$true;break};Start-Sleep -Milliseconds 500 }
 if(-not $archived){throw 'WAL_ARCHIVE_NOT_READY'}
 $config=@"
port=5544
listen_addresses=''
restore_command='cp /tmp/c4g-wal/%f %p'
recovery_target_name='c4g_target'
recovery_target_action='pause'

"@
 $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($config))
 Invoke-Docker exec -u postgres $name sh -c "echo $encoded | base64 -d >> /tmp/c4g-base/postgresql.auto.conf; touch /tmp/c4g-base/recovery.signal" | Out-Null
 Invoke-Docker exec -u postgres $name /usr/local/bin/pg_ctl -D /tmp/c4g-base -l /tmp/c4g-restore.log -w start | Out-Null
 $rows=Invoke-Docker exec $name psql -U proof_admin -d postgres -p 5544 -At -c "SELECT string_agg(id::text, ',' ORDER BY id) FROM public.proof_wal"
 if(($rows -join '') -ne '1,2'){throw 'PITR_CONTENT_MISMATCH'}
 $recovery=Invoke-Docker exec $name psql -U proof_admin -d postgres -p 5544 -At -c 'SELECT pg_is_in_recovery()'
 if(($recovery -join '') -ne 't'){throw 'PITR_NOT_IN_RECOVERY'}
 $result.checks=@('base backup created before later transactions','archived WAL replay reached named restore point','committed row before target recovered','row after target excluded','recovery remains paused at target');$result.status='PASS'
} finally {
 $env:POSTGRES_PASSWORD=$oldPassword
 if($created){
  try { $labels=(& docker inspect --format '{{json .Config.Labels}}' $name | ConvertFrom-Json);if($LASTEXITCODE -ne 0 -or $labels.'c4g.wal-proof' -ne $run){throw 'OWNERSHIP_UNCONFIRMED'}
   & docker rm --force --volumes $name *> $null;if($LASTEXITCODE -ne 0){throw 'CLEANUP_FAILED'};$result.cleanup='PASS'
  } catch {$result.cleanup='FAIL';$result.status='FAIL'}
 }
 $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'results.json') -Encoding UTF8
}
if($result.status -ne 'PASS'){throw 'WAL_PROOF_FAILED'}
