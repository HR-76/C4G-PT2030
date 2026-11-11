$ErrorActionPreference='Stop'
$run=[Guid]::NewGuid().ToString('N');$container="c4g-metadata-proof-$run";$created=$false
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $container --label "c4g.metadata-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'POSTGRES_START_FAILED'};$created=$true
 $ready=$false
 for($i=0;$i -lt 60;$i++){
  & docker exec $container pg_isready -U proof_admin -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 500
 }
 if(-not $ready){throw 'POSTGRES_NOT_READY'}
 $env:HTTP_PROOF_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${port}/postgres"
 $env:HTTP_PROOF_RUN=$run
 & node (Join-Path $PSScriptRoot 'proof-main.cjs')
 if($LASTEXITCODE -ne 0){throw 'METADATA_PROOF_FAILED'}
}finally{
 if($created){
  $labels=(& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json)
  if($LASTEXITCODE -eq 0 -and $labels.'c4g.metadata-proof' -eq $run){& docker rm --force --volumes $container *> $null}
 }
 Remove-Item Env:POSTGRES_PASSWORD,Env:HTTP_PROOF_ADMIN_URL,Env:HTTP_PROOF_RUN -ErrorAction SilentlyContinue
}
