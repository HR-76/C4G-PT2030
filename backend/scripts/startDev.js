'use strict';
// npm run dev uses the native two-database installation. Startup never seeds,
// migrates, changes passwords, or falls back to an alternate database.
const { readRuntimeState, assertExternalServices } = require('../../scripts/start-local.cjs');

// Diagnostics are selected from fixed messages. Neither error.message nor an
// upstream code is safe to print directly: either can contain private values.
const STARTUP_DIAGNOSTICS = Object.freeze({
  LOCAL_DEV_SETUP_REQUIRED: 'O ambiente local não está preparado. Execute "npm run setup:local" na raiz.',
  LOCAL_PLATFORM_SETUP_REQUIRED: 'O ambiente local não está preparado. Execute "npm run setup:local" na raiz.',
  LOCAL_DEV_STATE_INVALID: 'O estado privado local é inválido. Reveja .tmp/local-platform/runtime.json.',
  LOCAL_DEV_SERVICE_UNAVAILABLE: 'PostgreSQL indisponível em localhost:5432. Inicie o serviço PostgreSQL local.',
  LOCAL_DEV_IDENTITY_NOT_PREPARED: 'Falta o perfil Keycloak local preparado. Consulte LOCAL.md antes de continuar.',
  LOCAL_DEV_IDENTITY_START_FAILED: 'Não foi possível iniciar o Keycloak local. Abra o Docker Desktop e confirme os contentores c4g-f2-integration existentes.',
  LOCAL_DEV_IDENTITY_TIMEOUT: 'O Keycloak local não ficou disponível a tempo. Confirme o estado dos contentores Keycloak e proxy no Docker Desktop.',
  LOCAL_DEV_IDENTITY_CA_INVALID: 'O certificado da identidade local não está disponível. Confirme NODE_EXTRA_CA_CERTS no perfil privado indicado em LOCAL.md.',
  LOCAL_DEV_IDENTITY_PROFILE_UNKNOWN: 'O proxy local não usa um perfil de identidade reconhecido. Reveja o encaminhamento indicado em LOCAL.md.',
  LOCAL_DEV_IDENTITY_DATABASE_TIMEOUT: 'A base da identidade local não ficou disponível. Confirme o contentor c4g-native-email-pg no Docker Desktop.',
  LOCAL_PLATFORM_DEVELOPMENT_ONLY: 'Este comando exige NODE_ENV ausente ou development.',
  LOCAL_IDP_CA_CONFIGURATION_REQUIRED: 'Confirme Node 24.5.0 ou posterior e o certificado da identidade local indicado em LOCAL.md.',
  LOCAL_IDENTITY_TARGET_INVALID: 'A configuração da identidade local não corresponde à instalação preparada. Consulte LOCAL.md.',
  LOCAL_TENANT_BINDING_INVALID: 'O vínculo local ao tenant é inválido. Reveja a instalação preparada antes de continuar.',
  LOCAL_DATABASE_CREDENTIAL_REQUIRED: 'Configure PGPASSWORD em backend/.env.',
  LOCAL_DATABASE_TARGET_INVALID: 'A configuração PostgreSQL local é inválida. Consulte LOCAL.md.',
  LOCAL_DATABASE_IDENTIFIER_INVALID: 'A configuração PostgreSQL local é inválida. Consulte LOCAL.md.',
  CONTROLLED_CATALOG_START_REQUIRED: 'Confirme o modo controlado e o perfil de primeiro acesso na configuração local do catálogo.',
  CATALOG_SCHEMA_REQUIRED: 'A versão do esquema Central não é compatível com o catálogo controlado. Confirme as migrações registadas.',
  CATALOG_STARTUP_CONFIGURATION_INVALID: 'Reveja a configuração privada em .tmp/local-platform/catalog-controlled/settings.json.',
  CATALOG_CONTROLLED_TARGET_NOT_ADMITTED: 'Confirme a identidade da base Central, a suspensão da fonte EU e o acesso ativo do administrador da organização.',
  CATALOG_PROVIDER_NOT_READY: 'A validação das ligações de leitura do catálogo falhou. Confirme as credenciais e permissões locais do catálogo.',
  STORED_EVIDENCE_HASH_MISMATCH: 'Os ficheiros de evidência do catálogo não correspondem ao manifesto. Confirme a integridade dos ficheiros preservados.',
  STORED_EVIDENCE_ACCEPTED_SNAPSHOT_MISMATCH: 'A oportunidade EU 11145 preservada não corresponde à evidência aceite. Reveja os ficheiros do catálogo.',
  STORED_CATALOG_EXISTING_CONTENT_REQUIRES_REVIEW: 'O catálogo preservado diverge da versão publicada. Reveja o conteúdo antes de voltar a publicar.',
  CATALOG_STARTUP_GENERATION_WITHDRAWN: 'A versão preservada do catálogo foi retirada. Reveja o estado da publicação.',
  ENOENT: 'Falta um ficheiro da instalação local. Consulte LOCAL.md e confirme a preparação do ambiente.',
  '28P01': 'A autenticação PostgreSQL falhou. Verifique PGPASSWORD em backend/.env.',
  EADDRINUSE: 'Uma porta da API local está ocupada. Pare a API anterior antes de repetir o arranque.',
  ECONNREFUSED: 'Um serviço local recusou a ligação. Execute "npm run dev" na raiz para verificar PostgreSQL e Keycloak.',
  LOCAL_API_START_FAILED: 'Não foi possível iniciar a API local. Execute "npm run dev" na raiz para verificar os serviços locais.'
});

function startupDiagnostic(error) {
  const code = [error?.internalCode, error?.code, error?.message]
    .find(candidate => typeof candidate === 'string' && Object.hasOwn(STARTUP_DIAGNOSTICS, candidate))
    || 'LOCAL_API_START_FAILED';
  return `${code}: ${STARTUP_DIAGNOSTICS[code]}`;
}

async function main({
  readState = readRuntimeState,
  prepareServices = assertExternalServices,
  startRuntime = options => require('./localPlatform/runtime').startNative(options),
  logger = console,
  processApi = process
} = {}) {
  if (processApi.env.NODE_ENV && processApi.env.NODE_ENV !== 'development') throw Error('LOCAL_PLATFORM_DEVELOPMENT_ONLY');
  const state = readState();
  await prepareServices(state);
  const instance = await startRuntime({ state });
  logger.log('C4G API local: http://localhost:5000 — frontend: http://localhost:3000');
  let closing;
  const stop = () => closing ||= instance.close().then(() => { processApi.exitCode = 0; });
  processApi.once('SIGINT', stop); processApi.once('SIGTERM', stop);
  return instance;
}
if (require.main === module) main().catch(error => {
  console.error(startupDiagnostic(error));
  process.exitCode = 1;
});
module.exports = { main, startupDiagnostic };
