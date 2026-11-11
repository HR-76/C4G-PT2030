# F4 — Runtime metadata access (tenant 014)

Contrato aprovado em 2026-10-11. Reparo limitado da admissão do fluxo vertical F12; não é nova superfície administrativa ou funcional. Estado: **Complete — fecho formal restrito em 2026-10-12**, após correção de F4-014-R1-001, repetição da revisão read-only sem findings bloqueadores e decisão humana explícita. Não promove critérios F13.

O gate final repetido comprovou 29 drifts, incluindo mudança do fingerprint nos quinze casos de ACL de base, recusa HTTP e zero mutação/novo F7/idempotência; fluxo HTTP/Chrome A/B e runner 012→014→012→014 PASS. F4-014-R1-001 e UBI-V1-R1-001/R1-002/R1-003 corrigidos e revalidados. Nenhum ficheiro mudou durante a revisão read-only. A presente ação regista apenas o fecho documental, sem nova execução funcional, alterações a pins ou commit/stage.

F13 permanece In Progress; AC-13/AC-15 PARTIAL, AC-14/AC-16/AC-17 PENDING, restantes estados inalterados. IdP externo, rollout, provider/diretório externos, SLO e dados UBI reais não comprovados. A reserva 013 mantém-se; não se autoriza outra fatia, lifecycle/activation, matching ou candidaturas. Os registos de Review/provas exigidas abaixo são históricos, ultrapassados pela revisão final aqui registada.

## Reserva e runner

- `013_f13_constraints_and_epistemic_states`: RESERVED no manifest, sem SQL, checksum, fingerprint próprio ou linha de ledger. Nenhum placeholder é aplicado.
- `014_f4_runtime_metadata_access`: ordinal 14, aplicação efetiva após 012. Validator e trigger só admitem a lacuna 13 explicitamente reservada. Desconhecidos, lacunas diferentes, ledger adulterado e checksum divergente são recusados.
- Down autorizado somente 014→012. Apaga apenas a linha 014 sob o lock/controle do runner, restaura o trigger anterior e valida preflight/fingerprint 012. Reaplicação produz novamente 014, sem 013. Falhas de SQL/ledger fazem rollback integral.
- Reativação futura de 013 requer plano explícito; não preencher retroativamente o ledger por inferência.

## Privilégios mínimos

| Identidade | Acesso permitido | Acesso recusado |
|---|---|---|
| owner `c4g_f4_metadata_owner` | NOLOGIN/NOINHERIT; USAGE c4g_system/async_exec; SELECT nos dois registos de controlo e apenas sete colunas indispensáveis aos flags F9; ownership da função | DML, administração, LOGIN, BYPASSRLS/superuser, outros dados funcionais |
| executor `c4g_f4_metadata_executor` | NOLOGIN/NOINHERIT; USAGE c4g_system; EXECUTE runtime_metadata_v1(uuid,uuid) | SELECT/DML direto, CREATE, ownership/administração, acesso a outros schemas/objetos |
| API login | LOGIN/NOINHERIT; CONNECT na base atribuída; SET via aggregator API para executor e role funcional F12 existente, INHERIT FALSE/ADMIN FALSE | owner/migrator/role geral/worker, privilégios diretos em objetos e CREATE/TEMP na base |
| aggregator API | NOLOGIN/NOINHERIT; apenas duas memberships SET TRUE/INHERIT FALSE/ADMIN FALSE (F12 e executor) neste fluxo | grants diretos, owners, grants adicionais ou admin option |
| PUBLIC, runtime geral, worker e roles externas | nenhum EXECUTE na função de metadata | chamadas à função ou reutilização do login/pool API |

Owner só observa colunas F9 de integridade (`lineage_version`, `state`, `delivery_kind`, `attempt`, `root_execution_id`, `content_digest`, `envelope_digest`) internamente; a função não devolve valores de linhas, IDs de execução, digests funcionais ou payloads. Não concede leitura geral de outbox, catálogo, documentos ou perfil.

## Função e composição

`c4g_system.runtime_metadata_v1(expected_tenant uuid, expected_generation uuid)` é SECURITY DEFINER, owner NOLOGIN de permissões mínimas, search_path fixo pg_catalog. Sem SQL dinâmico ou parâmetros de autoridade humana. Recusa null/mismatch; devolve exclusivamente marcador/generation/revisão, ledger/checksums/fingerprints e dois booleans de integridade. PUBLIC e role geral não têm EXECUTE.

F4/security é owner do contrato. A composição tenant deriva tenant/generation da directory confiável, nunca do HTTP. Valida atributos/memberships do session_user e aggregator, ausência de grants diretos/ownership, ACLs/definição da função e fingerprint **antes** de executar SECURITY DEFINER. Metadata JSON é fechado e tipado; strings truthy não são flags válidos. Marker, ledger, capacidades e fingerprint são revalidados.

A aquisição preliminar é uma transação READ ONLY na conexão API limitada. Não emite capability de execução. Na transação funcional F4, a mesma conexão/client físico serve metadata, loaders, F5, mutação, F7, idempotência e commit guard; metadata é revalidada antes do commit. SET LOCAL ROLE é restaurado; erro SQL implica rollback/discard, nunca reutilização de conexão contaminada. Não há pool legacy ou preparação superuser neste fluxo.

F12 HTTP exige explicitamente F4_RUNTIME_METADATA_ACCESS. Read/write em versões anteriores não têm fallback. Recovery de COMMIT incerto permanece no protocolo Central existente, consulta tenant com o mesmo contrato e reautoriza F3/F5; nenhum resultado é presumido só porque o processo falhou. PUT/replay são receipts sem conteúdo; GET exige READ. Não reintroduzir o oracle de validação antes de F5.

## Pins

F4-014-R1-001: ACLs da base atual para owner/executor/PUBLIC são incluídas no fingerprint, com grant options. Runtime recusa CREATE/TEMP/CONNECT efetivos para owner/executor, incluindo PUBLIC/herança. O contrato não concede esses privilégios. Sem grants inesperados a projeção canónica mantém-se igual: não modifica SQL ou pins de tenant 014 nem migrations anteriores. Prova real PASS com quinze drifts adicionais de base (CREATE/TEMP/CONNECT para ambas as roles, com/sem grant option, e PUBLIC), HTTP recusado e ausência de mutação/F7/idempotência; total 29 drifts no gate HTTP/Chrome. Gate contém ainda asserção explícita de mudança do fingerprint para cada drift de base, a executar na repetição read-only. Backend 682/682, focados 72/72, gate F12/F9 PASS. Estado Review, sem fecho automático; documentação/código congelados antes da revisão final.

- Up: `5051cc10b19d034d30969ab63f1aa9275716b4e51da3eb866b6e7fd09d8ee7d1`
- Down: `6e91968cc279cfa787344285d3d9ad1191fba3690d23062bbad9644868a76937`
- Fingerprint: `039997acfeb75dd7540ebaad805ed9a18aec4cdc3418bf155c205c1cad87b1b3`

Nenhuma migration/pin anterior é alterada. Compatibility 014 é acrescentada às operações existentes cujos schemas funcionais não foram modificados, sem novas permissões ou bundles.

## Provas e limites

Gate real: `powershell -NoProfile -File test/integration/ubi/private-opportunity-gate.ps1`. PostgreSQL 17, Central real + dois tenants, logins API NOINHERIT, mesmos provider/binding verifier produtivos; directory/residency e dados são fixtures sintéticas. Pool wrapper só injeta falhas de append/ack e adulteração de resposta para provas negativas, sem trocar a identidade funcional por admin. Migrations/provisioning/assertions usam a identidade de setup, não são a preparação runtime.

Comprovado pelo gate (exit 0): HTTP/Chrome lista→detalhe→CAS→releitura; A/B; grants assimétricos; replay após revogação READ; zero mutação/F7/idempotência nas recusas; 14 drifts de grants/owner/membership/search_path/atributos, grants diretos API e ADMIN OPTION; metadata stale e quatro adulterações JSON; restauração COMMIT/ROLLBACK; runner 012→014→012→014 e falhas entre SQL e ledger em up/down. Backend 682/682, focados 72/72, frontend 15/15/build, gates F12/F13-P1/F13 e F9 PostgreSQL 3/3 PASS. Node --check 23 ficheiros e git diff --check PASS. Evidência, comandos e limites finais em current-work.md. Não constitui fecho formal ou rollout.

Down recusa alteração de roles compartilhadas se outra base do cluster ainda as usa; não revoga autoridade de outro tenant. Requer procedimento operacional de downgrade, não comando API. Indisponibilidade de metadata mantém recovery fail-closed; não presume rollback. IdP externo, rollout, dados UBI reais e disponibilidade/SLO continuam sem prova operacional nesta fatia. Worker metadata e outros perfis API não são implicitamente admitidos. Matching, F13 lifecycle e tenant 013 ficam fora do âmbito.
