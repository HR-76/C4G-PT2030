param([int]$Port=5566,[string]$Name='c4g-directory-probe')
$ErrorActionPreference='Stop'
if(-not (($Port -eq 5566 -and $Name -eq 'c4g-directory-probe') -or ($Port -eq 5567 -and $Name -eq 'c4g-directory-integration') -or ($Port -eq 5568 -and $Name -eq 'c4g-directory-pg18'))){throw 'Isolated proof target required'}
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$folder=Join-Path $root '.tmp/organization-directory'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$existing=& docker ps -a --filter "name=^/$Name$" --format '{{.Names}}'
if($existing){throw 'Proof container already exists; preserved.'}
$secret=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$config=@{host='127.0.0.1';port=$Port;user='c4g_f12_admin';password=$secret;database='postgres'}
$file=Join-Path $folder "$Name.json"
[IO.File]::WriteAllText($file,($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $file /inheritance:r /grant:r "*${sid}:F" '*S-1-5-18:F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not protect proof credentials'}
$image=if($Port -eq 5568){'postgres:18-alpine'}else{'postgres:17-alpine'}
& docker run --detach --name $Name --label c4g.environment=organization-directory-proof --env "POSTGRES_PASSWORD=$secret" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${Port}:5432" $image | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not start isolated proof database'}
for($i=0;$i -lt 30;$i++){
 & docker exec $Name pg_isready -U c4g_f12_admin -d postgres *> $null
 if($LASTEXITCODE -eq 0){Write-Output 'Isolated directory proof database ready';exit 0}
 Start-Sleep -Seconds 1
}
throw 'Isolated database not ready; preserved'
