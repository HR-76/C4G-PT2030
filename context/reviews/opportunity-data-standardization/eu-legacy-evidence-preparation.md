# Evidência oficial e preparação da migração EU por identidade

31/10/2026. Âmbito fixo: as 398 identidades EU ainda em v1, sem candidato v2 nem decisão de revisão, identificadas no inventário read-only. Esta preparação não altera a base habitual. A fonte EU permanece `QUIESCED`, fence 7, com escritor `CANONICAL_V2` e mapeamento alinhado.

## Evidência recolhida

- A API pública oficial foi consultada individualmente para os 398 identificadores fixos, com limites por chamada, cadência e zero repetições automáticas. O [manifesto](../../../output/eu-legacy-evidence-dc17365a-c3d9-40f7-b8c5-327b6bd0a5ed/manifest.json) referencia um artefacto por ID com SHA-256, hora de observação, variantes e fingerprint de evidência. Foram encontrados 391 candidatos v2 válidos e sete conflitos; não houve respostas ausentes ou erros de transporte.
- Os 391 candidatos incluem 401 dotações em 389 IDs; dois IDs não têm dotação publicada na evidência: `EDF-EDIP-P-2026-FNLC-CSA-PREP` e `HORIZON-NEB-2027-01-REGEN-03-CANCELLED`. Todas as 401 dotações estão normalizadas como número decimal; a moeda mantém `NOT_FOUND`, pois a evidência consultada não a declara de modo inequívoco. Todos os 391 têm pelo menos um prazo. Nenhum identifica concedente direto explícito; o nome do portal não foi convertido em `European Commission` como financiador.
- `CASCADE:17045` tem `CANONICAL_TITLE_CONFLICT` entre campos oficiais. `CEF-T-2021-AFIFCOEN-WORKS-LNG`, `CEF-T-2021-AFIFCOEN-WORKS-ZE`, `CEF-T-2021-AFIFGEN-UNITS`, `CEF-T-2021-AFIFGEN-WORKS-LNG`, `ERASMUS-EDU-2022-ECHE-CERT-FP` e `ESC-HUMAID-2021-QUAL-LABEL-FP` têm `SOURCE_VARIANTS_DIVERGE`. As variantes foram conservadas; nenhum dos sete recebeu candidato ou valor escolhido por inferência.

## Preview de migração

O [preview JSON](../../../output/eu-legacy-migration-preview-3c9c520e-0a4e-4eef-bfcd-fe5921bf62b5.json) e a [fila CSV](../../../output/eu-legacy-migration-preview-3c9c520e-0a4e-4eef-bfcd-fe5921bf62b5.csv) foram gerados em transação PostgreSQL `REPEATABLE READ READ ONLY`, após verificar hashes dos 398 artefactos, fingerprints, snapshots canónicos e heads atuais. Os 398 pares de revisão/`rowVersion` coincidiram com o inventário. O resultado por identidade é 391 `CHANGE_REQUIRES_APPROVAL` e sete `NO_CANDIDATE`. Os 391 são migrações v1, todas com `LEGACY_MIGRATION_REQUIRES_REVIEW` e `MAPPING_BASELINE_UNAVAILABLE`; não há atualização automática permitida. O CSV contém identificador, campos principais, dotação, estado da moeda, prazos, motivo, CAS e caminho do arquivo para revisão humana.

O digest de mapeamento observado nos ficheiros foi calculado antes de um ajuste diagnóstico posterior. O preview revalidou cada snapshot com o adaptador atual e calculou o digest atual separadamente; a configuração do escritor habitual coincide com o código atual. O arquivo offline é evidência consultiva, não é um `funding_candidate_v2` durável nem um plano aprovado.

## Aprovação e execução

Estado de aprovação: **`NOT_REQUESTED` para 391**, **`NOT_ELIGIBLE` para sete**. Zero arquivos ou revisões escritos na base habitual, zero aceitações, zero retomas. A rota administrativa OIDC existente `/api/admin/opportunity-activation/plans` exige um `funding_candidate_v2` verificável, associado a run concluído; por isso não serve para aprovar previamente o próprio arquivo.

A decisão do utilizador exige aprovação **antes do arquivo**. Foi acrescentada uma pré-aprovação separada, `GET/POST /api/admin/opportunity-activation/eu-legacy/preapprovals/:packageId/:itemDigest[/approve]`. A rota requer sessão OIDC, administrador atual, origem e CSRF; volta a validar o arquivo oficial, snapshot, digest do escritor, fence 7, revisão/rowVersion v1 e inexistência de candidato/revisão pendente. A aprovação grava apenas um evento crítico de auditoria com digest por identidade e recibo; não grava `funding_candidate_v2`, não aceita revisão e não retoma EU. Uma repetição com o mesmo `requestId` tem intenção determinística. O [pacote temporário](../../../output/eu-legacy-preapproval-23595dcf-9e7f-4804-9f59-0043cf3809f3/plan.json) e a [fila de 398 linhas](../../../output/eu-legacy-preapproval-23595dcf-9e7f-4804-9f59-0043cf3809f3/queue.csv) associam os 391 itens elegíveis ao `itemDigest` e `bindingDigest`; os sete conflitos não têm autorização possível. O pacote expira em **31/10/2026 22:55:34 UTC** e terá de ser renovado com preview atual se não for revisto nessa janela.

O evento de pré-aprovação ainda **não foi emitido**. A execução futura precisa de verificar esse evento e a validade do pacote antes de qualquer arquivo candidato, repetir fonte/CAS/evidência no mesmo âmbito, preparar backup/restauro próprios, e pedir a aprovação distinta para aceitar a revisão após o arquivo. O escritor automático atual arquiva candidatos v1 quando a fonte está ativa; portanto **não se pode retomar EU** até o gate de pré-arquivo estar integrado nesse percurso ou até usar um executor restrito que comprove o recibo. A fonte permanece `QUIESCED`. Os sete conflitos aguardam resolução editorial sustentada pela fonte oficial e nova evidência.

## Validação

- Sintaxe dos dois scripts e de `source.js`: PASS.
- Regressão focada do adaptador/fonte/escritor EU: 31 PASS.
- Suite completa backend: 2 359 PASS, zero FAIL, sete SKIP. Frontend: 496 PASS; build PASS.
- A correção diagnóstica identifica a contradição de título na fonte sem alterar o adaptador v2 nem o digest do escritor configurado.
- Pré-aprovação: 391/391 arquivos e bindings validados; probe na BD habitual com a role `c4g_opportunity_central_runtime` verificou três identidades (uma com dotação, duas sem), locks/CAS/fence e zero escritas. Testes focados backend da rota, auditoria e gates: 15 PASS; suite completa backend 2 362 PASS/7 SKIP; frontend 497 PASS e build PASS.

Artefactos e testes são relativos ao estado de 31/10/2026. Uma janela posterior exige preview e aprovação renovados; o presente preview não é um comando de escrita.
