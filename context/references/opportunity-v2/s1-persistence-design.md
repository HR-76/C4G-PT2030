# S1 — desenho aditivo da persistência v2

30/10/2026. Estado: desenho preparado; **nenhuma migração aplicada ou registada na sequência executável**. Este documento complementa o [contrato S0](contract.md) e o [plano da feature](../../features/opportunity-data-standardization.md). O manifesto candidato é [s1-persistence-candidate.json](s1-persistence-candidate.json). Não modifica o pacote S0 congelado ou a sua evidência.

## Base existente e fronteira

O catálogo central usa `opportunity_catalog.opportunity`, `revision`, `provenance` e idempotência desde a migração006. A revisão contém snapshot/normalização/qualidade JSONB e digest; o ponteiro corrente e números de versão pertencem à oportunidade. A migração015 acrescenta identidades e observações Funding; 033–035 acrescentam cobertura, refresh e resolução. A última migração central encontrada no repositório é `035_funding_source_resolution`; isto não é um preflight de base real.

Restrições atuais relevantes: `funder_name` obrigatório, versões de normalização/qualidade limitadas a v1 e campos singulares de programa/data. `funding_run_item.source_fields` está limitado a 32 KiB. `funding_identity` tem uma identidade por oportunidade e chave externa global. Estes contratos não podem receber v2 por simples troca de `schemaVersion`, aumento global de limites ou preenchimento fictício de financiador. O módulo S1 não é importado pelos escritores ativos.

Preservar todos os UUIDs, números de revisão/rowVersion, snapshots, digests v1, proveniência, correções e resoluções. As referências privadas de interesses/candidaturas continuam a apontar às identidades/revisões originais; não há migração tenant nem promoção de dados privados neste desenho.

## Modelo proposto

Os nomes seguintes são o desenho lógico da migração futura, não tabelas já criadas. IDs internos são gerados/resolvidos no servidor; a fonte fornece apenas os seus próprios identificadores.

| Objeto | Chave, dados e restrições |
| --- | --- |
| `opportunity` existente | Acrescentar `current_schema_version smallint` com default1 e check1/2. Manter identidade/lifecycle/ponteiro/CAS. Só depois dos leitores duais prontos, permitir null em aliases/score não representáveis no v2 e checks condicionais por versão; v1 continua a exigir os seus campos |
| `revision` existente | Acrescentar discriminante `snapshot_schema_version` derivado do snapshot, com check1/2; payload v1 permanece intocado. Para novos v2: limite JSONB256KiB, contractVersion fixado e invariantes verificadas antes da escrita. Snapshot factual é a autoridade; normalização/qualidade seguem versões distintas |
| `source_identity_v2` | PK `(source_namespace, external_identifier)`; FK opportunityId estável. Várias fontes podem referir a mesma oportunidade, após ligação comprovada; unicidade nunca baseada em título. Transporte não integra a chave |
| `source_alias_v2` | PK namespace/ID legado → FK da identidade canónica. Guarda motivo/decisão e evidência de equivalência; não altera aliases históricos nem liga plano a aviso por similaridade |
| `source_observation_v2` | UUID interno, namespace/ID externo observado, observedAt/sourceModifiedAt, coverage, hash SHA-256, referência protegida do artefacto e metadados documentais. Append-only; admite identidades ainda não criadas no catálogo, sem FK obrigatória a `source_identity_v2` ou `funding_identity` |
| `revision_evidence_v2` | PK `(revision_id, local_evidence_id)`; FK composta à revisão e FK à observação interna; locator/tipo/transformação. Liga os IDs locais do snapshot às observações persistidas, sem usar IDs de cliente como autoridade |
| `revision_allocation_v2` | PK `(revision_id, allocation_key)`; FK composta revisão/oportunidade; decimal canónico + projeção `NUMERIC(32,8)`, moeda/estado, interpretação do zero, scope/basis/aggregation, grupo/período/qualificadores. Sem unicidade pelo valor: duas dotações distintas não são fundidas |
| `revision_financial_detail_v2` | PK `(revision_id, collection, ordinal)` para support/rates/eligibleCosts; limites decimais, moeda/estado, unidade/âmbito/condições. Não mistura apoio individual com dotação total |
| `revision_concept_v2` | PK `(revision_id, collection, concept_key)`; conceitos de programas/fundos e, quando necessário aos filtros, outras classificações. IDs/códigos/rótulos/esquemas/versões/mapping preservados |
| `revision_allocation_concept_v2` | FKs à dotação e ao programa/fundo da mesma revisão. Relação N:M; não repetir o montante por associação |
| `revision_deadline_v2` | PK `(revision_id, ordinal)`; precisão e campos distintos `date_value date`, `instant_value timestamptz`, `period_start/end date`, label/fase/fuso original. CHECK por precisão, sem fabricar hora para DATE/PERIOD |
| `source_candidate_v2` | Staging versionado com namespace/ID externo e FK observação, candidato/digest/mapping, estado de validação e motivos. Associação à oportunidade nullable até publicação. Limite próprio v2; não alargar o limite32KiB de `funding_run_item` v1 nem usar o tenant como staging central |

O conjunto de campos e coleções permanece fechado pelo schema. O desenho SQL não constitui um segundo schema factual editável. Acrescentar uma FK composta `(opportunity_id, revision_id)` também ao ponteiro corrente exige primeiro confirmar que o histórico satisfaz essa relação; inconsistência encontrada bloqueia o gate, sem reparar ou apagar dados automaticamente.

Descoberta e consulta individual precedem a criação: observação/candidato não dependem de uma oportunidade já existente. A ligação `source_identity_v2` à oportunidade é criada apenas quando o candidato é admitido na transação de catálogo; `revision_evidence_v2` liga então a revisão à observação anterior. Isso evita repetir a incompatibilidade P3 da FK de `funding_refresh_target`, sem a remover ou enfraquecer. Um registo novo inválido fica em staging e não ganha oportunidade fictícia para satisfazer uma FK.

O alargamento das restrições legadas é condicionado ao discriminante: v1 conserva normalização/qualidade v1 e requisitos atuais; v2 usa `opportunity-normalization-v2`/`opportunity-quality-v2.0` e pode ter aliases nulos. Não inventar `funder_name`, escolher o primeiro programa, transformar total em limite por candidatura, ou preencher um score0 como substituto de qualidade desconhecida. A qualidade v2 é constituída por estados/issues; a eventual apresentação de um score fica na integração S5. Os leitores antigos não podem ser usados para registos v2 após ativação.

## Projeção pura preparada em S1

`projectPersistenceV2(snapshot, {opportunityId, revisionId, revisionNumber, rowVersion})` valida ambos os inputs e devolve uma projeção imutável com revisão/snapshot/digest, identidades, dotações, apoios/taxas/custos, calendários e programas/fundos. Não abre conexões, não gera IDs, não executa SQL, não escolhe autoridade e não substitui o CAS. O adaptador futuro tem de receber este envelope do contexto de servidor autorizado.

Todas as linhas derivadas levam os mesmos opportunityId/revisionId. Valores monetários permanecem strings decimais exatas no driver; `pg` não os transforma em `Number`. Arrays de linhas vazios consultam o estado do Fact original no snapshot; não significam ausência certificada. Os 120000 da11145 ficam numa dotação com currencyState NOT_FOUND; 1500/EUR fica em support. Os seis programas do8514 referem uma dotação. O8664 conserva zero e ZERO_UNEXPLAINED.

## Dinheiro e constraints

Uma coluna NUMERIC com escala declarada pode arredondar antes de um CHECK sobre o número. Assim, o texto canónico deve ser validado **antes do cast**, incluindo limite de24 inteiros/8 decimais. O writer valida o schema e o normalizador; a futura fronteira SQL deve igualmente verificar a expressão lexical antes de converter. Uma opção concreta é guardar `amount_canonical text` com CHECK da regex normativa e `amount numeric(32,8) GENERATED ALWAYS AS (amount_canonical::numeric(32,8)) STORED`; o texto fora do limite faz falhar a transação, nunca persiste arredondado.

As linhas financeiras são extraídas da revisão validada pela operação de persistência, nunca aceites como listas editáveis independentes do cliente. O gate verifica igualdade snapshot→texto→numeric→releitura para valores extremos, zero e18181527.09. Deve também rejeitar percentagens fora de0–100, limites invertidos, refs órfãs e snapshots maiores que256KiB em JSONB. Moeda null exige estado/motivo; não default EUR. Decimais v1 historicamente maiores permanecem no seu snapshot; não passar todo o histórico pelo cast v2.

## Transação e idempotência

1. Revalidar autoridade central/membership/grants e fence do job no adaptador existente; não aceitar tenant/role do payload.
2. Validar candidato/mapping/limites. Resolver identidade por namespace+ID e aliases comprovados, antes de decidir criação. Confirmar a publicação sem apagar a previsão.
3. Obter lock/CAS da oportunidade e idempotência com âmbito central, identidade, operação, expectedRowVersion, versão de mapping e digest da intenção. Retry idêntico reproduz resultado; requestId igual com intenção diferente falha.
4. Comparação semântica igual: registar observação operacional sem criar revisão/alterar UUID. Proposta de alteração não é autorização para substituir dados: a função S1 fixa `canReplaceAccepted=false`; o workflow futuro aplica precedência e correções editoriais.
5. Ausência/erro/conflito: conservar revisão aceite e guardar candidato/diagnóstico. Não eliminar, arquivar ou apagar campo por desaparecimento numa resposta.
6. Alteração aprovada: inserir revisão imutável, links de evidência e projeções derivadas, atualizar ponteiro/versões com CAS, anexar auditoria/outbox/idempotência na mesma transação. Uma falha reverte tudo; nunca publicar o ponteiro com finanças de outra revisão.

Digest factual não substitui digest de intenção ou autorização. Horas/IDs transitórios/bytes diferentes de recolha não criam revisões de factos resolvidos. Para CONFLICT/UNSUPPORTED, os candidatos podem existir apenas no artefacto opaco: S1 conserva locator/excerto/hash dessa evidência no digest, preferindo revisão conservadora a ocultar mudança de candidato. Não se trata de autorização para sobrescrever a revisão aceite.

## Permissões e ativação

Novas tabelas ficam sob owner central de catálogo, sem PUBLIC. Runtime de catálogo recebe só operações necessárias; observações/evidências/revisões têm guardas append-only também para TRUNCATE. Leitor central recebe apenas projeções públicas necessárias, sem acesso indiscriminado a staging, artefactos ou decisões editoriais. O acesso privado continua nos repositórios tenant existentes e na membership central; não adicionar grants tenant para recolha.

O manifesto candidato mantém número/checksum/fingerprint de migração null e `executable=false`. Só atribuir a sequência após rever o manifesto central então atual, implementar SQL e medir o fingerprint em PostgreSQL isolado. Não editar006/015/033/034/035 nem seus checksums para acomodar v2. A ativação exige leitores v1/v2, consumidores S5, regressão P3 resolvida e gates abaixo. Reversão operacional desliga novos writers por fonte, mantendo leitores duais/dados; não elimina revisões nem faz downgrade destrutivo.

## Gates preparados

| Gate | Prova necessária antes de ativar |
| --- | --- |
| G1 — contrato | Seis snapshots normativos; validação, normalização, leitura dual, digest e projeções puras; schema runtime byte-idêntico ao S0 |
| G2 — SQL isolado | Aplicar candidato sobre cópia isolada compatível, validar constraints/guardas/roles e fingerprint; provar preservação de todas as revisões v1 e referências |
| G3 — decimal/calendário | Valores extremos exatos/rejeições, zero/null distintos, JSONBbytes, datas civis sem hora, sete cut-offs; snapshot/projeções/releitura conciliados |
| G4 — concorrência | Descoberta de ID inédito sem identidade/catálogo prévio, consulta individual antes de criação, CAS/stale, mesma intenção/replay, intenção divergente, rollback, duas fontes concorrentes, observação sem revisão artificial |
| G5 — autoridade | Escrita central restrita, revogação/fence, reader sem staging/segredos, zero escrita e exposição cruzada tenant |
| G6 — fontes/consumidores | Adaptadores S2–S4 e lista/detalhe/exportação/filtros/dashboard S5 na mesma revisão; não perder financiamento nem contar previstos como abertos |
| G7 — operação | Preview/diff histórico, reconciliação de contagens, rollout por fonte, alertas de conflito/recusa, recuperação sem remoção de dados |

G1 é executado localmente nesta fase. G2–G7 são gates preparados e pendentes; exigem implementação e, para infraestrutura/aplicação SQL, âmbito isolado autorizado. As suites unitárias não substituem essas provas.
