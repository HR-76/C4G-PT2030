# Preparação da ativação por fonte — 31/10/2026

Estado: **Review — preparação implementada e validada**. Nenhuma fonte ativada e nenhuma migração, aprovação ou escrita funcional realizada no ambiente habitual.

## Preview real

[Evidência JSON](../../../output/opportunity-v2-activation/real-preview.json), produzida por `node backend/scripts/localPlatform/prepareOpportunityV2.js --preview-real`. Ligações restritas às duas bases locais identificadas na configuração existente; transações REPEATABLE READ READ ONLY, verificação da identidade/base e rollback final. Segredos não entram no relatório. Dados privados permanecem na base; apenas contagens e checksums de preservação são recolhidos.

Baseline observada: PostgreSQL 18.3, Central 035 (`8b772f6cd36d2abb4bf9a69ddc553230f827d97400ef1ac0c7e8f98f69bd649e`) e tenant 033 (`d3526c7287fade9a1009ce223be8d36769c38b9345f89e9c72180cb940c793bc`), com preflights válidos. Catálogo com 538 oportunidades, todas v1: 536 identidades EU e duas POCTEP. Zero jobs de financiamento QUEUED/RUNNING no instante da observação. Zero candidaturas/interesses no tenant observado; isso não substitui os testes de preservação com dados existentes do S6.

O recorte compara **191 candidatos públicos normativos com o catálogo real**: um EU, 177 Portugal2030, três Interreg e dez POCTEP. Capturas de 30/10/2026; não houve nova recolha dos portais. O exemplo manual sintético do S6 foi excluído. Não se afirma cobertura das restantes 535 oportunidades nem se propõe eliminá-las.

| Fonte | Novas identidades propostas | Migrações sujeitas a aprovação | Bloqueadas | Decisão de preparação |
| --- | ---: | ---: | ---: | --- |
| EU Funding & Tenders | 0 | 1: CASCADE:11145 | 0 | Primeiro candidato a ensaiar; preservar UUID e revisão v1 |
| Interreg Europe | 3 | 0 | 0 | Lote pequeno separado, após EU |
| POCTEP | 8 | 1: chamada 9 | 1: chamada 10 | Rever 1–9; excluir 10 até resolver evidência documental |
| Portugal2030 plano | 177 | 0 | 0 | Dependente da cadeia documental central; não ativável nesta fase |
| Autoria manual | — | — | — | Sem candidato real fabricado; criar apenas a partir de declaração editorial autorizada |

Nenhum arquivo v2 candidato/aceite está instalado na base habitual. Portanto NEW significa proposta de reconciliação, não candidato verificado nem autorização de criação. A aprovação operacional terá de ser feita sobre o arquivo efetivo e um preview novamente calculado.

### Chamada 11145

UUID atual `01a14a80-9143-7177-ba86-9fa72d09fb64`, revisão `01a184d1-0c76-714d-bff6-b141fd140159`, rowVersion 4. Não existem correções/resoluções protegidas nos três registos encontrados pelo recorte.

| Campo | Catálogo real v1 | Candidato normativo v2 |
| --- | --- | --- |
| Título | Gnomon Internships Offer | Preservado |
| Programa/referência | DIGITAL / DIGITAL-2023-SKILLS-05-SPECIALEDU | Conceito e referência estruturados |
| Financiador/atribuidor | Rótulo European Commission sem papel classificado | Gnomon Informatics SA como DIRECT_AWARDER; não converter automaticamente o portal/programa em atribuidor direto |
| Total funding available | Não recolhido na revisão aceite | Decimal canónico `120000`; persistência NUMERIC32,8 comprovada no S6 |
| Moeda da dotação | Ausente | NOT_FOUND; não inferir EUR da moeda de outro campo |
| SUSA/acordo 101190010 | Não recolhidos | PRESENT |
| Abertura | 2025-06-30, instante também preservado em sourceTemporal | 2025-06-30T00:00:00.000Z |
| Cut-offs | Sete instantes com offset +0000 | Sete instantes UTC canónicos, último 2028-09-02T04:59:00.000Z |
| Fecho plano legado | 2027-01-03 | Separar próximo prazo do prazo final; não reinterpretar o campo como fim definitivo |

**O valor 120000 ainda não está armazenado como dotação na revisão aceite habitual.** Está correto no candidato normativo e foi persistido no ensaio S6; a preparação não migrou o registo real. O JSON inclui as duas projeções completas dos campos públicos para revisão.

## Composição operacional preparada

`createOpportunityActivationV2` expõe `prepare`, `approve`, `revoke` e `accept` em composição opt-in. O [contrato](../../references/opportunity-v2/activation-preparation-contract.md) exige sessão/autoridade centrais atuais, aprovação durável, arquivo rederivado, fence e auditoria na mesma transação. Não recebe snapshots factuais fornecidos pelo cliente: resolve o arquivo no servidor e rederiva-o pelo adaptador.

Cada plano cobre um candidato/fonte, guarda preview, revisão esperada, mapping, hashes e decisão. TTL de uma hora; estados DRAFT→APPROVED→REVOKED e fence crescente. A aceitação humana cabe ao mesmo administrador que aprovou, com sessão/atribuição central revalidadas. A autenticação deve ser recente segundo a política existente; MFA permanece opcional. A aprovação não ignora correções, resoluções ou conflitos documentais.

O fence é **do plano**, não é lease de worker nem interruptor global da fonte. SERVICE é recusado até existir integração autenticada do worker; Portugal2030 é recusado até existir cadeia documental central comprovada. A composição não foi importada no startup, em rotas HTTP ou nos escritores ativos. A interface autenticada/CSRF e a coordenação dos escritores permanecem etapas de ativação, não capacidades alegadamente ensaiadas nesta preparação.

Auditoria usa o ledger platform existente, com eventos de preparação/aprovação/revogação e criação/revisão/proveniência. Payload limitado a IDs, hashes e códigos, sem sessão, tokens ou dados privados. Falhas de autoridade/aprovação/auditoria fazem rollback. O SQL candidato acrescenta apenas os três eventos de decisão em falta nas duas allowlists, preservando os códigos anteriores e a rejeição de códigos desconhecidos.

## Validação concluída

[Resumo da validação](../../../output/opportunity-v2-activation/validation-summary.json) e [gate PostgreSQL](../../../output/opportunity-v2-s6-873a1be1490345168fbc95ed48f14c47/verification.json).

- **14 checks PostgreSQL PASS**, 25 eventos com cadeia de auditoria válida, limpeza do contentor confirmada. Os 342 ficheiros de entrada mantiveram os hashes durante o ensaio e na conferência final.
- Sessão/admin/assurance persistidos e privilégios mínimos; recusa de utilizador suspenso, sessão/atribuição revogada, autenticação antiga, SERVICE e contexto divergente. Locks serializam revogação.
- Preparação, aprovação concorrente/replay sem segundo evento, aceitação, fence e revogação; chave de aceitação não pode ser reutilizada por outro plano/autor. Falha SQL real na auditoria desfaz revisões, observações e recibos.
- Arquivos reais dos adaptadores, em dados de ensaio: EU 11145, Interreg 1, POCTEP 1 e manual aceites; POCTEP 10 e documento PT2030 recusados. `120000`, moeda NOT_FOUND e sete prazos conferidos em SQL. UUID e revisão v1 preservados.
- Resolução histórica `funding_resolution` efetivamente inserida: um candidato com factos alterados foi bloqueado e a decisão/histórico preservados. Fecha a lacuna de prova SQL identificada no S6.
- Duas allowlists de auditoria verificadas com 144 casos cada; preservação do catálogo anterior e admissão estrita dos três novos eventos.
- Backend **2073 PASS / 0 FAIL / 7 SKIP**; frontend **488 PASS**, build PASS; foco 29 PASS e sintaxe 14 PASS. Os sete skips existentes não foram apresentados como testes executados.
- Pacote S0: 16 artefactos intactos, Excel original e fixture com o hash normativo. 119 ficheiros de migrações/manifestos/fingerprints ativos iguais à baseline S6.

As regressões corrigiram exigência indevida de MFA, verificação física do tenant antes de agregados privados, identidade por namespace+externalId, checkout aninhado de pool e replay sem vínculo ao plano. O ensaio encontrou e corrigiu sintaxe/regex PostgreSQL e a allowlist SQL de auditoria. As tentativas FAIL permanecem em `output/opportunity-v2-s6-*`; a prova final acima identifica os bytes aprovados, sem reescrever essas falhas como sucesso.

Limites: gate em PostgreSQL 18.6; habitual 18.3. Sessões e alterações de autoridade foram fixtures isoladas, respeitando os permits REGISTER/APPLY/APPLIED e guards existentes. Não se certifica login OIDC, admission do coordenador sobre o futuro manifesto, endpoint HTTP, worker autenticado ou quiescência habitual. O tenant permaneceu 033 neste gate; a migração de capacidade v2 e a preservação de snapshots privados com dados são a prova S6 separada. Não houve recolha atual dos portais, backup/restauro habitual ou ativação por fonte.

## Pacote candidato medido

[Descritor não executável](../../references/opportunity-v2/activation-preparation-candidate.json): `approved=false`, `registered=false`, `activated=false`, ordinais `null`. Contém SHA-256 de cada SQL e fingerprints intermédios de schema, autoridade e catálogo.

| Ordem do ensaio central | SQL candidato | Objetivo |
| ---: | --- | --- |
| 1 | funding_canonical_v2.up.sql | Arquivo EU/Interreg/POCTEP |
| 2 | manual_opportunity_v2.up.sql | Arquivo editorial |
| 3 | pt2030_plan_v2.up.sql | Estruturas candidatas PT; ingestão continua bloqueada |
| 4 | opportunity_persistence_v2.up.sql | Revisões/projeções aceites e proteção do histórico |
| 5 | opportunity_activation_authority_v2.up.sql | Helper de autoridade, privilégios mínimos e eventos de auditoria |
| 6 | opportunity_activation_approval_v2.up.sql | Planos e decisões duráveis |

Fingerprint central final: `a90a0f06dddf1f33d71bc5076771e97b91c0e9d8313d3f0823a694971059af15`; autoridade: `acb6daf8d58e240e14b5ce57e2228eb857ac37229b4700b735385576c0521286`. Catálogo de segurança permaneceu `b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5`. Estes valores não foram registados nas admissões ativas. Alterar a ordem/conteúdo ou excluir uma etapa exige novo ensaio e fingerprint.

## Plano de migração e recuperação

1. **Congelar o pacote a aprovar.** Fixar código, hashes dos SQL candidatos e ordem cumulativa medida pelo ensaio. Registar novas ordinais somente num incremento de ativação aprovado; preservar integralmente os ledgers035/033. Os fingerprints S6 referem-se apenas à persistência S6, não ao pacote cumulativo de arquivos/autoridade/aprovação.
2. **Completar os percursos operacionais.** Compor a interface autenticada do administrador com CSRF, sessão e política atuais; o módulo opt-in não cria uma rota pública. Para automação, implementar lease autenticado e fence do worker antes de permitir SERVICE. Garantir que cada fonte tem um único escritor e que os coletores v1 não tentam atualizar registos jáv2. Coordenar EU/CORDIS/ERASMUS pela identidade EU comum.
3. **Pré-condições por fonte.** EU: arquivo de11145 verificado e preview exato; Interreg: três arquivos oficiais; POCTEP:1–9 sem conflito,10 excluída; manual: declaração editorial imutável; PT2030: documento central com hash/bytes do Excel, verificação antivírus e worker central,177linhas/2301células. A API PT2030 continua fora do pacote até certificação semântica própria.
4. **Reabrir janela autorizada.** Reexecutar preview READ ONLY, preflights/ledger/identidade/fingerprint, confirmar revisões, correções e resoluções. Drenar/pausar os escritores afetados, impedir novas admissões e esperar leases expirarem. A observação atual de zero jobs não é um lock. Reconfirmar capacidades/snapshots de todos os tenants consumidores; não generalizar a observação de um tenant.
5. **Renovar backup e provar restauro.** Na pausa, produzir backups Central/tenants e configuração em diretório com ACL restrita; verificar hashes, contagens, sequências, grants e ledgers após restauro isolado. Reutilizar os controlos de `backupOpportunityInterests.js`, adaptando o contrato/baseline ao novo pacote; não executar esse script antigo como ativador. Backups anteriores não cobrem esta janela. Não alegar backup/restauro realizado nesta preparação.
6. **Aplicar somente o pacote aprovado.** Arquivos S2/S4, persistência S6, autoridade e aprovação em migrações centrais transacionais ordenadas, com fingerprint após cada etapa. Instalar capacidade de snapshot v2 nos tenants antes de admitir candidaturas com256KiB; preservar32KiB parav1. Atualizar diretório/capacidades e metadados restritos apenas através do fluxo aprovado. SQL PT2030 pode permanecer diferido até a cadeia documental estar completa; qualquer sequência diferente exige nova medição isolada.
7. **Recolher e rever antes de aceitar.** Arquivar nova observação oficial sem publicar; preparar plano por candidato, conferir campos e diffs, aprovar o digest/fence exato, aceitar com CAS. Começar por11145 e verificar `120000`, moeda explícita, SUSA/acordo, sete prazos, UUID/histórico, auditoria e consumidores. Qualquer drift invalida a aprovação e exige novo preview.
8. **Prosseguir por lotes pequenos.** Interreg, POCTEP1–9, autoria manual e finalmente PT2030, cada um com evidência própria e condições satisfeitas. Confirmar filtros, paginação, dashboard, matching e snapshots privados após cada lote. Não usar uma aprovação global para candidatos posteriores ou diferentes.

### Critérios de interrupção e recuperação

Interromper perante fingerprint/ledger divergente, backup/restauro inválido, escrita concorrente, CAS falhado, sessão/autoridade/aprovação expirada ou revogada, arquivo/mapping divergente, falha de auditoria, perda de campos, conflito não resolvido ou consumidor incompatível. A transação falhada faz rollback integral; não repetir automaticamente com outra chave para contornar a falha.

Antes da primeira aceitação, manter escritores pausados e corrigir o pacote/reensaiar; conservar migrações aditivas compatíveis sempre que seguro. Depois de existir v2 aceite, **não repor o writer v1 nem remover tabelas/colunas v2**: revogar o plano/incrementar o fence, suspender a fonte e manter leitores compatíveis. Preferir correção por nova revisão auditada, preservando a anterior. Não há comando genérico para recuar o ponteiro da revisão.

Se for indispensável restauro integral, fazê-lo numa base/generation nova, validar o backup e reconciliar escritas posteriores antes da troca controlada de bindings. Preservar a base anterior para investigação; um restauro in-place perderia aceitações e dados privados posteriores. RPO é o backup da janela (ainda não criado); RTO tem de ser medido nesse ensaio, não inferido do S6.

Recuperação concluída apenas quando preflights, autoridade, auditoria, histórico, contagens/checksums, vínculos privados e leituras HTTP/OIDC estiverem comprovados, e as fontes autorizadas retomarem sem escritores legados concorrentes.

Próximo passo: integrar o percurso autenticado de aprovação e a suspensão dos escritores EU, preparando a janela autorizada para migrar primeiro a chamada 11145.
