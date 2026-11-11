# AV-01: fronteira de privilégios antes da factory documental

Estado atualizado: perfil Tenant autorizado e validado em bases descartáveis;
fronteira de leitura do diretório Central ainda pendente. A proposta inicial e
a sua evidência são mantidas abaixo como histórico.

## Evidência

Na base descartável instalada pelo runner oficial até Tenant 032, o login API
provisionado segundo o perfil atual seleciona `c4g_opportunity_tenant_runtime`,
mas `SET LOCAL ROLE c4g_document_runtime` devolve 42501. Auditoria e outbox já são
permitidas ao role opportunity. O role documental permite as escritas F11, mas
não outbox. O perfil do worker não é uma alternativa admissível para a API.

O launcher anterior usa pool de preparação no repository documental, seleciona
`c4g_audit_writer` para auditoria e `c4g_document_worker_runtime` para enqueue.
Essa montagem não estabelece um perfil funcional API limitado completo.

## Proposta mínima para o bloqueio medido

Autorizar o perfil API documental composto por:
- `c4g_opportunity_tenant_runtime`: operação de candidatura, auditoria e outbox já permitidas;
- `c4g_document_runtime`: operações F11 já definidas pelas migrations;
- `c4g_f4_metadata_executor`: verificação do binding/schema.

O login continua apenas membro do agregador API, NOINHERIT, com SET explícito,
sem ADMIN OPTION. Não atribuir roles owner, migrator, worker ou writer genérico.
O novo vínculo documental ao agregador é uma ampliação de capacidade e precisa
de autorização; não foi efetuado. O provisionamento deve ser explícito, fora do
arranque, com validação exata da cadeia e recusa de drift. Não se pressupõe SQL
histórico alterado nem se afirma que uma migration nova é inevitável.

Na implementação posterior, reutilizar o pool manager/binding API e validar
snapshot/schema antes de qualquer acesso F11. A autorização da candidatura
continua anterior ao lookup. Auditoria e outbox usam o role funcional existente,
sem consumidor pg-boss na API. Não se promete atomicidade entre bases.

Esta proposta resolve o bloqueio de role demonstrado. Não certifica ainda o
restante loader, a ligação Central limitada, readiness do worker nem a operação
documental HTTP: essas fronteiras têm de passar na prova positiva posterior.

## Trabalho independente realizado

Drenagem partilhada em `backend/src/resourceDrain.js`, ownership de recursos,
encerramento/arranque parcial do entrypoint e regressões dirigidas. O helper de
ensaio reexporta a implementação produtiva; produção não importa `test/`.
F12 não executa o bootstrap de schema legacy. O loader R2 canonicaliza apenas a
origem HTTPS EU e recusa credenciais, query, fragmento e porta não padrão no URL.

Não fecha AV-01 nem substitui o ensaio com a factory completa.

## Decisão autorizada e resultado da continuação

Foi acrescentado apenas o vínculo `c4g_document_runtime` ao agregador API com
SET TRUE, INHERIT FALSE e ADMIN FALSE. Provisionamento novo, atualização da
baseline exata e reexecução conforme foram medidos. Perfil parcial, herança,
SELECT direto e drift na ACL documental são recusados sem reparação silenciosa.
COMMIT/ROLLBACK restauram o role; owner, migrator, worker, writer e delegação
continuam recusados. Escrita F11, auditoria e enqueue funcionam pelos roles
previstos. Os snapshots Tenant antes/depois têm o mesmo fingerprint oficial;
o vínculo funcional é validado separadamente, como no provisionamento F4 existente.

Não se alteraram SQL histórico, manifesto ou permissões de tabela. O comando de
instalação não faz parte do arranque e não provisiona o worker nem o diretório.

## Proposta seguinte, ainda não implementada nem autorizada

Expor uma leitura restrita de snapshot F4 por organização e workload através
de uma fronteira limitada própria ou da autoridade existente, sem SELECT genérico
no runtime. Ela deve devolver apenas o material de resolução já definido por
`tenantDirectoryRepository.resolveSnapshotByOrganization`, com organização
derivada de contexto server-side e workload fechado. O diretório é necessário
também ao preflight de arranque; esse uso é de infraestrutura, não concessão de
autoridade funcional ao utilizador.

O owner da autoridade já tem parte das leituras, mas a ACL de
`tenant_workload_connection_version` não lhe dá SELECT na baseline medida.
Qualquer novo EXECUTE/SELECT restrito e admissão de versão devem ser explícitos,
testados numa nova migration, sem ampliar o leitor do catálogo. Não se propõe
ligação administrativa, enumeração global, escrita/provisionamento por esse port
ou concessão de memberships. Inventariar as nove relações da query antes de
definir exatamente as ACL; o diagnóstico atual não autoriza esses grants.

Evidência: `C:/Users/Utilizador/c4g-evidence/api-autonomous-composition/20261025-191321/`.
