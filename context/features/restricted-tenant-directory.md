# Resolução restrita do diretório Tenant — AV-01

Autorização de 2026-10-25: resolver um snapshot F4 existente pela autoridade,
sem SELECT genérico no runtime, nova fonte de verdade ou administração funcional.

O chamador é a composição server-side API/worker. O port recebe uma lista finita
de organizações da configuração externa e um workload fixo; não é endpoint HTTP.
No startup é descoberta técnica da infraestrutura configurada. No percurso
funcional, sessão, membership e grants são validados antes da descoberta; esta
operação não concede acesso a candidaturas/documentos. Não recebe host, base,
password ou SQL de utilizadores. Retorna apenas o snapshot existente, interno.

A query fixa exige organização ativa, workload fechado, binding e versão
disponíveis, provisionamento READY, geração não retirada e referência/digest/fence
coerentes. O resolver continua a verificar região, schema e destino físico.
Não há cache novo: a revalidação existente antes de COMMIT vê alterações.

Implementação: nova Central 031 acrescenta uma query allowlisted à
função de autoridade existente, mantendo owner/search_path/EXECUTE e memberships.
Somente o owner não-login recebe as leituras de colunas ainda ausentes em três
relações do diretório. Runtime e catálogo não recebem SELECT. Migration exige
predecessor 030 exato, mede snapshots, recusa drift; nenhuma reescrita histórica.
É aditiva e irreversível como as extensões 028–030 do protocolo; recuperação por
backup/forward migration, sem inventar rollback que revogue acesso em uso.

Critérios: resolução válida e negativas de organização/estado/workload/contexto;
runtime sem SELECT/DDL/admin; role restaurado em sucesso/erro; instalação,
upgrade e drift por runner oficial; depois npm start real, OIDC/contexto,
HTTP documental, reinício/persistência e drenagem. Storage controlado só em
teste explícito. Não declarar AV-01 fechado se qualquer prova positiva faltar.

## Resultado local de 25/10/2026

Central 031 medida em duas bases equivalentes e instalada pelo runner oficial.
Upgrade 030 → 031, rollback de falha transacional e recusa de drift comprovados.
O owner recebe SELECT de 20 colunas em três tabelas; não há novo EXECUTE,
membership, privilégio de catálogo ou SELECT direto no runtime.

A API usa a lista `DOCUMENT_API_ORGANIZATIONS_JSON`; o worker deriva o âmbito
das credenciais WORKER configuradas. Ambos usam o coordinator existente. A
allowlist de organizações é uma fronteira de composição, não uma política SQL
por utilizador: o serviço de autoridade é confiável e continua a autorizar
sessão, membership e grants separadamente. O port não é publicado no HTTP.

O worker passa a exigir `AUTHORITY_DATABASE_URL` e
`AUTHORITY_COMMIT_PERMIT_SECRET` externos, separando autoridade de fila. Os dois
pools pertencem ao worker e são fechados também quando o provider falha ao carregar.

AV-01 continua aberto: falta um perfil funcional limitado/provisionamento para
`pgboss`. A instalação oficial de schema 45 não concede USAGE/SELECT aos roles
limitados testados; a ligação de instalação não é alternativa funcional. Não
foram acrescentados grants de fila. A prova positiva de `npm start`, HTTP e
persistência após reinício permanece pendente. Não é validação de VPS ou R2.
