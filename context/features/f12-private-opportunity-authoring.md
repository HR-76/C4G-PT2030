# F12 — Criação e arquivo privados pela APP existente

**Percurso histórico, substituído em 29/10/2026:** a [criação manual pertence exclusivamente à Administração C4G](central-manual-opportunity-authoring.md) e alimenta o catálogo central. As rotas privadas de criação, edição e arquivo são recusadas; leitura e dados históricos são preservados. As descrições seguintes registam a entrega anterior.

Estado: Review. Entrega funcional 2 aprovada e comprovada em 2026-10-12; pronta para revisão formal read-only, sem fecho automático. Não fecha F12 integral nem altera estados F13.

## Contrato e corte

- Modo explícito OPPORTUNITIES_RUNTIME=f12 exige OIDC, directory/pools tenant e admissão F4/tenant 014 fechada; sem fallback. Nenhuma migration nova.
- GET /api/opportunities: vista ACTIVE por defeito, cursor; ARCHIVED apenas por filtro explícito. READ próprio. Permissão de criação devolvida server-side, nunca ADMIN/PROFESSOR.
- GET /api/opportunities/:id: READ próprio, conteúdo e permissões derivadas; histórico arquivado consultável, edit/archive false se ARCHIVED.
- POST /api/opportunities: requestId UUID + fields fechados (os campos editáveis F12 existentes). Organização/actor/membership, namespace/timestamp da proveniência e versões de normalização/qualidade server-side. ACTIVE e PENDING_REVIEW fixados, sem validação manual implícita. OPPORTUNITY_PRIVATE_CREATE/opportunity.private.create em âmbito ORGANIZATION.
- PUT /api/opportunities/:id: edição existente, expectedRowVersion e requestId, OPPORTUNITY_PRIVATE_UPDATE independente.
- POST /api/opportunities/:id/archive: requestId UUID + expectedRowVersion, action ARCHIVE fixa. OPPORTUNITY_ARCHIVE/opportunity.archive próprio, policy MFA/SoD F5 existente. Não concede READ, update ou restore.
- Todas as mutações devolvem apenas opportunityId/revisionId/revisionNumber/rowVersion; GET é a única resposta de detalhe. Arquivo é lógico e cria revisão/histórico, não elimina o registo. DELETE e outras subrotas não migradas no namespace F12 são 405.
- /api/legacy/opportunities conserva as rotas/controllers/pool piloto existentes, incluindo criação, edição, DELETE legacy e research-areas/suggestions/auto-research-areas. Não são percursos multi-instituição. Restantes módulos legacy preservados, não migrados nesta entrega. Nenhum dados legacy alterados.

## Persistência, replay e falhas

Mesmo client físico preparado F4 para loaders/F5/dados/F7/idempotência/commit guard. Criação serializa por organização+CREATE+requestId com advisory transaction lock, digest completo da intenção HTTP (incluindo summary) independente de timestamp/provenanceId gerados. Mantém o contrato de digest dos callers anteriores fora do namespace HTTP. Arquivo usa CAS e idempotência por operação/target/revisão; replay passa novamente por F3/F5 antes da leitura do resultado. Eventos OPPORTUNITY_CREATED e OPPORTUNITY_ARCHIVED críticos na transação; replay não duplica evento funcional. Commit incerto usa coordinator/recovery existentes, consultando a operação CREATE/UPDATE/ARCHIVE exata, sem novas superfícies de autoridade.

Frontend reutiliza lista/detalhe, formulário F12, ConfirmDialog e ToastProvider. Mostra organização ativa; sem moeda por defeito. Criação conserva key/intenção e bloqueia alteração após resultado incerto; receipt conhecido + READ recusado não reenvia criação. Arquivo exige confirmação, CAS e releitura. Erros de validação/recusa/sessão/conflito/indisponibilidade são controlados. Não redesenha interface nem liga candidaturas ou matching.

## Critérios desta entrega

| ID | Prova exigida | Estado |
|---|---|---|
| E2-01 | Criar→listar→abrir→editar→arquivar→ausência ACTIVE→GET histórico autorizado | PASS — HTTP/Chrome sintéticos |
| E2-02 | Dois tenants/utilizadores; ausência de descoberta/acesso cruzado | PASS — PostgreSQL/HTTP/Chrome |
| E2-03 | Grants CREATE/ARCHIVE/READ assimétricos, revogação e contexto inválido | PASS — F3/F5 real; contexto de organização suspensa não emitido |
| E2-04 | Idempotência, intenção divergente, concorrência CREATE e conflito CAS arquivo | PASS — PostgreSQL/HTTP |
| E2-05 | F7 persistido sem duplicação, rollback de evento crítico e sem hard delete | PASS — evento real e injeção funcional pós-mutação |
| E2-06 | COMMIT incerto CREATE/ARCHIVE reconciliado/reautorizado | PASS — ACK perdido após COMMIT real |
| E2-07 | UI/HTTP fechados, recusam tenantId/organizationId; estados de erro | PASS — HTTP/unit UI |
| E2-08 | Gates/regressões, sintéticos apenas, pins/migrations/legacy preservados | PASS — âmbito desta entrega |

Evidência: backend 685/685, focados 75/75, frontend 27/27/build, gate F12/F9 PostgreSQL e gate HTTP/Chrome final PASS; node --check 12 JS, git diff --check e scans PASS; comandos/resultados/limites em current-work.md. Estes PASS são restritos às fixtures e contratos desta entrega, não a rollout, IdP/onboarding externos ou critérios integrais F13. UI não persiste conteúdo/key entre encerramentos do browser; um resultado ainda incerto deve ser reconciliado pelo procedimento operacional/estado tenant antes de criar nova intenção. Arquivo não inventa maker-checker: o mesmo utilizador autorizado pode arquivar a oportunidade que criou, sujeito ao grant e policy/SoD F5 existentes.

## Checklist limitada do piloto — pendente

### Correção e segunda revisão — 2026-10-17

F12-E2-R1-001: preflight passa a obter as capacidades cumulativas do manifest tenant, incluindo importação na revisão 019; mantém recusa de revisão desconhecida e de tabelas em falta/excesso. Oito testes de regressão PASS; gate PostgreSQL real ultrapassou o preflight e a fase forward.

F12-E2-R1-002: harness HTTP deixa de fixar ordinal 17; downgrades adjacentes pelo runner canónico até 012, preflight/fingerprint em cada passo e reaplicação do manifest atual, sem ledger/SQL 013. A injeção de falha down exige comprovar que chegou à alteração do ledger. Execução PostgreSQL real ultrapassou esse percurso e as assertions HTTP até à chamada final browserCreationFlow; o gate global terminou FAIL porque a porta 5173 estava ocupada. O processo preexistente não foi terminado; não há PASS E2E global nesta execução.

Validação da correção: backend 834/834, focados 85/85, frontend 69/69 e build PASS; node --check nos três JS da correção e diff --check do âmbito PASS. Gate F12 cumulativo Central/tenant passou, mas o gate completo parou no restart: TRUNCATE opportunity_catalog.opportunity CASCADE alcança proteção F13_AUTHORING_APPEND_ONLY. Novo finding F12-E2-R2-001 (MEDIUM), test/integration/f12/gate.js:20: adaptar as fixtures/reexecução ao histórico append-only sem desativar triggers; repetir gate integral, incluindo F9 PostgreSQL ainda não executado nesta correção. Entrega continua Review, sem fecho registado e sem promoção de critérios; resultados históricos acima não substituem esta revalidação pendente. Migrations/pins e estados F13 preservados.

- Issuer/realm e cliente OIDC, redirects/logout, endpoints/JWKS, URLs frontend/API HTTPS e origens permitidas; confirmar IdP e MFA externos com prova real.
- Stable subjects, organizações de demonstração e memberships elegíveis; base role não substitui grants. Onboarding real não validado por fixtures.
- Directory por organização, residência aprovada, geração/system identifier/binding/version/fence/schema 014, logins API NOINHERIT e CONNECT isolado; referências de credenciais via gestão aprovada, nunca guardar valores secretos aqui.
- Central geral e pool dedicada authority coordinator, preflight/ACLs válidos; sessão/registry/stores e recovery disponíveis.
- Grants explícitos opportunity.read/private.create/private.update/archive; policy/assurance recente e SoD de arquivo; confirmar matriz de utilizadores, não pressupor ADMIN.
- Backups/restore, supervisão API/worker, observabilidade e procedimento operacional de reconciliação; custos/SLO/rollout não provados nesta entrega.

Valores externos e instituições/utilizadores reais ainda por fornecer/validar. Fixtures sintéticas não comprovam IdP, diretório/provider externos, conteúdo editorial, onboarding ou rollout. Próxima importação exige formato/mapeamento/idempotência e proveniência aprovados; candidaturas exigem contrato de migração separado. Tenant 013 continua RESERVED; F13 In Progress, AC-13/15 PARTIAL e AC-14/16/17 PENDING.
