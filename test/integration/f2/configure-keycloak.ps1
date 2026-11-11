param([Parameter(Mandatory=$true)][string]$EnvFile)
$ErrorActionPreference = 'Stop'

$values = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
}

$base = 'http://127.0.0.1:8080'
$realm = 'c4g-test'
$token = (Invoke-RestMethod -Method Post -Uri "$base/realms/master/protocol/openid-connect/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
  grant_type = 'password'
  client_id = 'admin-cli'
  username = 'f2-admin'
  password = $values.F2_KEYCLOAK_ADMIN_PASSWORD
}).access_token
$headers = @{ Authorization = "Bearer $token" }

function Invoke-Keycloak([string]$Method, [string]$Path, $Body = $null) {
  $parameters = @{ Method = $Method; Uri = "$base/admin/realms/$realm/$Path"; Headers = $headers }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }
  Invoke-RestMethod @parameters
}

function Set-ExecutionRequirement([string]$FlowAlias, [string]$ExecutionId, [string]$Requirement) {
  $execution = (Invoke-Keycloak Get "authentication/flows/$FlowAlias/executions").Where({ $_.id -eq $ExecutionId }) | Select-Object -First 1
  if (-not $execution) { throw "Execution $ExecutionId was not found in $FlowAlias." }
  Invoke-Keycloak Put "authentication/flows/$FlowAlias/executions" @{
    id = $execution.id
    requirement = $Requirement
    displayName = $execution.displayName
    requirementChoices = @($execution.requirementChoices)
    configurable = $execution.configurable
    authenticationFlow = $execution.authenticationFlow
    providerId = $execution.providerId
    authenticationConfig = $execution.authenticationConfig
    flowId = $execution.flowId
    level = $execution.level
    index = $execution.index
    priority = $execution.priority
  } | Out-Null
}

function Add-Execution([string]$FlowAlias, [string]$Provider, [string]$Requirement, [string]$Reference = $null) {
  Invoke-Keycloak Post "authentication/flows/$FlowAlias/executions/execution" @{ provider = $Provider } | Out-Null
  $execution = (Invoke-Keycloak Get "authentication/flows/$FlowAlias/executions").Where({ $_.providerId -eq $Provider }) | Select-Object -Last 1
  Set-ExecutionRequirement $FlowAlias $execution.id $Requirement
  if ($Reference) {
    Invoke-Keycloak Post "authentication/executions/$($execution.id)/config" @{
      alias = "f2-reference-$Reference-$FlowAlias-$Provider"
      config = @{ 'default.reference.value' = $Reference }
    } | Out-Null
  }
  $execution
}

function Add-LoaFlow([string]$ParentAlias, [string]$Alias, [int]$Level, [int]$MaxAge, [string]$Authenticator, [string]$Reference) {
  Invoke-Keycloak Post "authentication/flows/$ParentAlias/executions/flow" @{
    alias = $Alias
    description = "F2 disposable LoA $Level"
    provider = 'basic-flow'
    type = 'basic-flow'
  } | Out-Null
  $subflow = (Invoke-Keycloak Get "authentication/flows/$ParentAlias/executions").Where({ $_.displayName -eq $Alias }) | Select-Object -Last 1
  Set-ExecutionRequirement $ParentAlias $subflow.id 'CONDITIONAL'
  $condition = Add-Execution $Alias 'conditional-level-of-authentication' 'REQUIRED'
  Invoke-Keycloak Post "authentication/executions/$($condition.id)/config" @{
    alias = "f2-loa-$Level-condition"
    config = @{ 'loa-condition-level' = "$Level"; 'loa-max-age' = "$MaxAge" }
  } | Out-Null
  Add-Execution $Alias $Authenticator 'REQUIRED' $Reference | Out-Null
}

$existingFlow = (Invoke-Keycloak Get 'authentication/flows').Where({ $_.alias -eq 'f2-browser' }) | Select-Object -First 1
if ($existingFlow) {
  $existingRealm = Invoke-Keycloak Get ''
  if ($existingRealm.browserFlow -eq 'f2-browser') {
    $existingRealm.browserFlow = 'browser'
    Invoke-Keycloak Put '' $existingRealm | Out-Null
  }
  Invoke-Keycloak Delete "authentication/flows/$($existingFlow.id)" | Out-Null
}
Invoke-Keycloak Post 'authentication/flows' @{
  alias = 'f2-browser'
  description = 'F2 disposable versioned LoA browser flow'
  providerId = 'basic-flow'
  topLevel = $true
  builtIn = $false
} | Out-Null
Add-Execution 'f2-browser' 'auth-cookie' 'ALTERNATIVE' | Out-Null
Invoke-Keycloak Post 'authentication/flows/f2-browser/executions/flow' @{
  alias = 'f2-forms'
  description = 'F2 disposable interactive forms'
  provider = 'basic-flow'
  type = 'basic-flow'
} | Out-Null
$forms = (Invoke-Keycloak Get 'authentication/flows/f2-browser/executions').Where({ $_.displayName -eq 'f2-forms' }) | Select-Object -First 1
Set-ExecutionRequirement 'f2-browser' $forms.id 'ALTERNATIVE'
Add-LoaFlow 'f2-forms' 'f2-loa1' 1 300 'auth-username-password-form' 'pwd'
Add-LoaFlow 'f2-forms' 'f2-loa2' 2 2 'auth-otp-form' 'otp'

$realmConfig = Invoke-Keycloak Get ''
if (-not $realmConfig.attributes) { $realmConfig | Add-Member NoteProperty attributes @{} }
$realmConfig.attributes | Add-Member NoteProperty 'acr.loa.map' '{"c4g-loa1":1,"c4g-loa2":2}' -Force
$realmConfig.browserFlow = 'f2-browser'
Invoke-Keycloak Put '' $realmConfig | Out-Null

$client = (Invoke-Keycloak Get 'clients?clientId=c4g-local')[0]
$client.attributes | Add-Member NoteProperty 'default.acr.values' 'c4g-loa2' -Force
$client.attributes | Add-Member NoteProperty 'minimum.acr.value' 'c4g-loa2' -Force
Invoke-Keycloak Put "clients/$($client.id)" $client | Out-Null
$clientMappers = Invoke-Keycloak Get "clients/$($client.id)/protocol-mappers/models"
foreach ($mapper in $clientMappers.Where({ $_.protocolMapper -eq 'oidc-amr-mapper' })) {
  Invoke-Keycloak Delete "clients/$($client.id)/protocol-mappers/models/$($mapper.id)" | Out-Null
}

$scope = (Invoke-Keycloak Get 'client-scopes').Where({ $_.name -eq 'f2-amr' }) | Select-Object -First 1
if (-not $scope) {
  Invoke-Keycloak Post 'client-scopes' @{ name = 'f2-amr'; protocol = 'openid-connect'; attributes = @{ 'include.in.token.scope' = 'false' } } | Out-Null
  $scope = (Invoke-Keycloak Get 'client-scopes').Where({ $_.name -eq 'f2-amr' }) | Select-Object -First 1
}
$mappers = Invoke-Keycloak Get "client-scopes/$($scope.id)/protocol-mappers/models"
if (-not $mappers.Where({ $_.protocolMapper -eq 'oidc-amr-mapper' })) {
  Invoke-Keycloak Post "client-scopes/$($scope.id)/protocol-mappers/models" @{
    name = 'f2-amr'
    protocol = 'openid-connect'
    protocolMapper = 'oidc-amr-mapper'
    config = @{ 'id.token.claim' = 'true'; 'access.token.claim' = 'true'; 'lightweight.claim' = 'false' }
  } | Out-Null
}
$defaults = Invoke-Keycloak Get "clients/$($client.id)/default-client-scopes"
if (-not $defaults.Where({ $_.id -eq $scope.id })) {
  Invoke-Keycloak Put "clients/$($client.id)/default-client-scopes/$($scope.id)" | Out-Null
}

$configured = Invoke-Keycloak Get 'authentication/flows/f2-browser/executions'
if (-not $configured.Where({ $_.displayName -eq 'f2-loa1' }) -or -not $configured.Where({ $_.displayName -eq 'f2-loa2' })) {
  throw 'F2 authentication flow validation failed.'
}
Write-Output 'Disposable Keycloak LoA/AMR configuration applied.'
