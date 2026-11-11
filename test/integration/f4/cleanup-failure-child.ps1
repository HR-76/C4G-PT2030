param([Parameter(Mandatory=$true)][string]$RunId,[Parameter(Mandatory=$true)][string]$OwnershipToken)
$ErrorActionPreference='Stop'
if ($RunId -notmatch '^[a-f0-9]{24}$' -or $OwnershipToken -notmatch '^[a-f0-9]{32}$') { throw 'Invalid cleanup ownership identifiers.' }
$prefix="c4g-f41-failure-$RunId";$container="$prefix-container";$network="$prefix-network";$volume="$prefix-volume";$label="c4g.f41.owner=$OwnershipToken";$password=[Guid]::NewGuid().ToString('N')
function Assert-Owned([string]$kind,[string]$name){if($kind-eq 'container'){$item=(& docker inspect $name|ConvertFrom-Json)[0];$observed=$item.Config.Labels.'c4g.f41.owner'}elseif($kind-eq 'network'){$item=(& docker network inspect $name|ConvertFrom-Json)[0];$observed=$item.Labels.'c4g.f41.owner'}else{$item=(& docker volume inspect $name|ConvertFrom-Json)[0];$observed=$item.Labels.'c4g.f41.owner'};if($observed-ne $OwnershipToken){throw "Cleanup ownership mismatch for $kind $name"}}
$exitCode=17
try {
 & docker network create --label $label $network | Out-Null;if($LASTEXITCODE-ne 0){throw 'network creation failed'}
 & docker volume create --label $label $volume | Out-Null;if($LASTEXITCODE-ne 0){throw 'volume creation failed'}
 & docker run --detach --name $container --label $label --network $network --mount "type=volume,src=$volume,dst=/var/lib/postgresql/data" --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_failure --env POSTGRES_DB=postgres postgres:17-alpine | Out-Null;if($LASTEXITCODE-ne 0){throw 'container creation failed'}
 $ready=$false;for($i=0;$i-lt 30;$i++){& docker exec $container pg_isready -U c4g_failure -d postgres *> $null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Milliseconds 500};if(-not $ready){throw 'postgres did not become ready'}
 & docker exec $container createdb -U c4g_failure c4g_f41_deliberate_failure;if($LASTEXITCODE-ne 0){throw 'database creation failed'}
 Write-Output 'EXPECTED_DATABASE_CREATED:c4g_f41_deliberate_failure'
 throw 'EXPECTED_INTERNAL_FAILURE_F4_CLEANUP'
} catch {if($_.Exception.Message -notmatch 'EXPECTED_INTERNAL_FAILURE_F4_CLEANUP'){Write-Error $_};Write-Output 'EXPECTED_INTERNAL_FAILURE_F4_CLEANUP'} finally {
 if((& docker container inspect $container 2>$null)){Assert-Owned 'container' $container;& docker rm --force $container *> $null}
 if((& docker volume inspect $volume 2>$null)){Assert-Owned 'volume' $volume;& docker volume rm $volume *> $null}
 if((& docker network inspect $network 2>$null)){Assert-Owned 'network' $network;& docker network rm $network *> $null}
}
exit $exitCode
