param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$run=[Guid]::NewGuid().ToString('N')
$container="gcni-durable-$run"
$created=$false
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$outputPath=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
if(Test-Path -LiteralPath (Join-Path $outputPath 'results.json')){throw 'USE_NEW_EVIDENCE_DIRECTORY'}
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $container --label "gcni.durable-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:18-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_POSTGRES_START_FAILED'};$created=$true
 $env:GCNI_DURABLE_OUTPUT=$outputPath;$env:GCNI_DURABLE_CONTAINER=$container;$env:GCNI_DURABLE_RUN=$run;$env:GCNI_DURABLE_PORT=[string]$port
 & node (Join-Path $PSScriptRoot 'gate.cjs')
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_DURABLE_GATE_FAILED; see sanitized results.json'}
} finally {
 $removed=$false
 if($created){
  $labels=(& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json)
  if($LASTEXITCODE -eq 0 -and $labels.'gcni.durable-proof' -eq $run){
   & docker rm --force --volumes $container *> $null
   $removed=$LASTEXITCODE -eq 0
  }
 }
 @{created=$created;ownedContainerRemoved=$removed;run=$run} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'cleanup.json') -Encoding utf8
 Remove-Item Env:POSTGRES_PASSWORD,Env:GCNI_DURABLE_OUTPUT,Env:GCNI_DURABLE_CONTAINER,Env:GCNI_DURABLE_RUN,Env:GCNI_DURABLE_PORT -ErrorAction SilentlyContinue
}
