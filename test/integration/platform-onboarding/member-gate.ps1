param([switch]$Probe,[switch]$Admission,[switch]$Draft,[switch]$Registration,[switch]$Completion)
$ErrorActionPreference='Stop'
$container="c4g-member-onboarding-$PID"
$password=[Guid]::NewGuid().ToString('N')
try {
 & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p 127.0.0.1:5599:5432 postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Disposable PostgreSQL unavailable'}
 $ready=$false
 for($attempt=0;$attempt -lt 30;$attempt++){
  & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break}
  Start-Sleep -Seconds 1
 }
 if(-not $ready){throw 'Disposable PostgreSQL not ready'}
 $env:F13_S2_ADMIN_URL="postgresql://c4g_f12_admin:$password@127.0.0.1:5599/postgres"
 if($Completion -and $Probe){& node (Join-Path $PSScriptRoot 'completion-migration-probe.js')}
 elseif($Completion){& node (Join-Path $PSScriptRoot 'completion-service-gate.js')}
 elseif($Registration -and $Probe){& node (Join-Path $PSScriptRoot 'registration-migration-probe.js')}
 elseif($Draft -and $Probe){& node (Join-Path $PSScriptRoot 'draft-migration-probe.js')}
 elseif($Draft){& node (Join-Path $PSScriptRoot 'draft-service-gate.js')}
 elseif($Admission -and $Probe){& node (Join-Path $PSScriptRoot 'admission-migration-probe.js')}
 elseif($Admission){& node (Join-Path $PSScriptRoot 'admission-service-gate.js')}
 elseif($Probe){& node (Join-Path $PSScriptRoot 'member-migration-probe.js')}
 else{& node (Join-Path $PSScriptRoot 'member-gate.js')}
 if($LASTEXITCODE -ne 0){throw 'Onboarding service gate failed'}
} finally {
 Remove-Item Env:F13_S2_ADMIN_URL -ErrorAction SilentlyContinue
 & docker rm --force --volumes $container *> $null
}
