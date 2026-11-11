# Catálogo de Oportunidades

## Apresentação do estado na tabela — 31/10/2026

Pedido confirmado: retirar as linhas secundárias «Ativa no catálogo» e «Requer revisão da fonte» da coluna Estado da tabela de oportunidades.

Critérios de aceitação: a célula conserva o selo do estado principal (por exemplo, Aberta); não apresenta linhas secundárias de lifecycle ou revisão da fonte. Os dados, filtros e informações do detalhe permanecem disponíveis.

## Regra vigente — 29/10/2026

[Criação manual exclusiva C4G](central-manual-opportunity-authoring.md), aprovada pelo utilizador: criação manual no catálogo central para fontes sem API. Clientes apenas consultam oportunidades e gerem os seus processos privados. Os percursos privados descritos abaixo são históricos; dados preservados, novas mutações HTTP desativadas nesta refatoração.

## Estado

- F12 — catálogo manual e fluxo privado: **Complete**, fecho formal em 2026-10-12.
- Importação XLSX Portugal 2030 de oportunidades privadas: **Complete**; fecho humano restrito aprovado em 2026-10-14 após revisão final read-only sem blockers materiais. Este estado não valida staging, produção ou rollout.

## Âmbito do MVP

- Catálogo central C4G.
- Oportunidades privadas por organização.
- Criação manual e primeiro MVP XLSX Portugal 2030 concluídos no âmbito local autorizado, com CSV inativo.
- Portugal 2030, EU Funding & Tenders, Erasmus+, Interreg Europe e POCTEP como fontes candidatas, sujeitas a validação técnica.
- CORDIS orientado a projetos, participantes e histórico, não a oportunidades abertas por omissão.
- Conectores independentes, agendados e idempotentes.

## Responsabilidades

A C4G mantém integrações comuns, normalização, deduplicação, qualidade, proveniência e correções do catálogo central. Cada organização mantém interesses, dados complementares, notas, qualificação, responsáveis e oportunidades privadas.

Uma organização não altera dados centrais para os restantes clientes.

## Deduplicação

Ordem de confiança:

1. identificador oficial;
2. programa e referência;
3. URL oficial normalizada;
4. entidade financiadora;
5. título normalizado;
6. datas;
7. conteúdo e características relevantes.

Correspondências exatas podem ser agregadas. Correspondências incertas exigem revisão humana. Fusões preservam fontes, identificadores, histórico e relações organizacionais.

## Qualidade e atualização

Estados: importada, por validar, validada automaticamente, validada manualmente, com conflito, desatualizada e arquivada.

Cada oportunidade indica fonte, URL, última atualização, completude, validação, conflitos e campos ausentes. Remoção na fonte externa nunca elimina o registo.

Cada execução guarda duração, versão/referência da fonte, criados, atualizados, rejeitados, duplicados e erros. Lotes com falha terminam em erro e podem ser repetidos sem duplicação.

## Fecho formal F12

O fluxo organização ativa → criar → listar/filtrar → detalhe → editar com CAS → arquivar foi aprovado sobre a composição F3/F4/F5/F7/F10/F12. As rotas migradas não usam pool ou controller legacy, não têm fallback silencioso e recusam `DELETE`; arquivo é lógico e não existe hard delete no percurso F12. As rotas `/api/opportunities` e `/api/opportunities/:id[/archive]` estão separadas de `/api/legacy/opportunities` e respetivas subrotas legacy.

Registo histórico do fecho manual de 2026-10-12: a revisão executou testes backend focados 74/74, suite backend 685/685, frontend 27/27, build Vite, `node --check` 141/141, `git diff --check`, scans de credenciais/PII, gates F12/F9/F13-P1/F13 e HTTP/Chrome com duas organizações sintéticas. A expectativa então desatualizada do gate de população 012 foi posteriormente corrigida; o runner canónico e o gate UBI/F4 passaram. Nenhum dado UBI real foi migrado. Tenant 013 permanece reservado e adiado.

Findings históricos do fecho manual: F12-UI-001 e F12-UI-002 antes do rollout produtivo; F13-GATE-012-001 posteriormente corrigido; F12-SEC-R1-001 e F12-UI-003 como melhorias não bloqueadoras. O `POOL_CLEANUP_TIMEOUT` isolado só exige investigação se voltar a ocorrer. O fecho não declara IdP externo, onboarding, provider/diretório, staging, produção, rollout ou SLO validados.

## Importação Excel/CSV de oportunidades privadas

### Identificação

- Tipo: `Feature`
- Estado: `Complete` — fecho humano restrito aprovado em 2026-10-14. `F12-IMPORT-R2-003` e `F12-IMPORT-R2-004` permanecem resolvidos; suites focadas e gerais e os gates funcional Central+A/B e cumulativo F12 passaram, sem alteração dos contratos dos dois findings.
- Objetivo: importar lotes de oportunidades privadas para a organização ativa, preservando o contrato F12, com preview, revisão humana, processamento F9, autorização F5, auditoria F7 e ficheiro original F11.
- Estado de autorização: implementação local do primeiro MVP XLSX autorizada; dados UBI reais, CSV ativo, conectores e rollout continuam proibidos.

### Contrato aprovado e estado de implementação (prevalece sobre o Draft histórico abaixo)

- Formato único ativo: `.xlsx` Portugal 2030, uma folha escolhida explicitamente. Máximo 10 MiB e 5 000 linhas; preview das primeiras 200 válidas e de todos os erros; um job ativo por organização.
- Aliases comprovados: `ID → externalIdentifier/callReference`; `Designação do Aviso → title`; `Programa → funderName/programmeName`; `Objetivo Específico → summary`; `Tipo Ent. Beneficiária → eligibilitySummary`; `Data Início Prevista → openingDate`; `Data Fim Prevista → closingDate`.
- Campos exigidos por linha: `ID`, `Designação do Aviso` e `Programa`; os headers de datas são exigidos no formato fonte e os valores presentes têm de ser datas válidas. Não se assume moeda, montante ou estado do ficheiro. O servidor fixa `DRAFT` e `PENDING_REVIEW`.
- Duplicados: `EXACT` não cria; `POSSIBLE` exige decisão humana com MFA recente; `DISTINCT` pode criar. Valores de catálogo desconhecidos não criam seeds/mappings.
- F5 aprovado: `opportunity_import.upload`, `.preview`, `.confirm`, `.read`, `.cancel`, `.review`, `.download_report`; MFA recente apenas em confirm/review, sem maker-checker. F7 aprovado ao nível do job: upload, confirmação, cancelamento, revisão, conclusão e falha; sem evento por linha.
- Persistência tenant `015` guarda job e outcomes sem conteúdo bruto; RLS organizacional, sem DELETE funcional. Original e relatório são referências F11 privadas; F9 usa envelope v2/outbox e linha como transação independente. Relatório UI/CSV: linha, estado, código, conflito e ID resultante.
- UI implementada para upload, folha, mapping, preview, confirmação, progresso, cancelamento, revisão POSSIBLE e relatório. O runtime F12 não recua para imports legacy; `/api/legacy/imports` é explícito.
- Evidência atual de integração: Testes focados F12 **27/27 PASS**, backend **713/713 PASS**, frontend **27/27 PASS** e build Vite **PASS** (aviso conhecido de chunk superior a 500 kB). Migration gate XLSX 015, gate funcional `F12_IMPORT_ENTRYPOINT_CENTRAL_AB`, gate cumulativo F12 e gate UBI completo/browser **PASS**. O primeiro clone executou esta matriz; o segundo repetiu focados, backend, build e gates funcional, cumulativo e UBI/browser sobre o mesmo patch, reproduzido byte-for-byte. PostgreSQL 17, Central e organizações A/B são fixtures sintéticas, sem dados UBI reais.
- Findings `F12-IMPORT-R1-001`, `F12-IMPORT-R1-002`, `F12-IMPORT-R1-003` e `F12-IMPORT-R1-004`: **RESOLVED**. A composição deixou de receber workflow/contexto prontos, o registry é executável pelo worker, replay de review não duplica F7, recursos F5 usam os tipos exatos e F10 é fechado/baixa cardinalidade. Não fica autorizada qualquer amostra UBI real.
- `F12-IMPORT-R2-001`: **RESOLVED**. O worker produtivo é dono do registry, relay, inbox, processor, polling e shutdown; selecionar o runtime XLSX sem composição explícita falha o arranque. A autoridade de execução é reconstruída a partir da Central, não do envelope.
- `F12-IMPORT-R2-002`: **RESOLVED**. O gate já não chama diretamente a composição de importação: inicia os entrypoints reais da API e do worker, usa HTTP e mede zero acessos à pool legacy.
- `F12-IMPORT-R2-003`: **RESOLVED** — header desconhecido sem decisão produz `IMPORT_HEADER_DECISION_REQUIRED`; `IGNORE` fica explícito no mapping/digest e é reproduzido no worker, enquanto `REJECT` recusa o ficheiro.
- `F12-IMPORT-R2-004`: **RESOLVED** — recusas funcionais F5 devolvem `403`; indisponibilidades técnicas continuam `503`.
- `F12-IMPORT-R3-001`: **RESOLVED, superseded pela correção R4**. O gate já não importa `worker.main` nem constrói/injeta o runtime, lançando `node src/worker.js` num processo separado sobre pg-boss real. A seleção configurável da factory completa foi posteriormente removida.
- `F12-IMPORT-R4-001`: **RESOLVED**. A factory produtiva é entregue em `backend/src/config/opportunityImportWorkerFactory.js` e compõe entrypoint, registry, polling e ownership do runtime. O provider configurável fica limitado às fronteiras externas de infraestrutura; o gate já não substitui a factory completa.
- `F12-IMPORT-R4-002`: **RESOLVED**. Timeout no shutdown força limpeza por `SIGKILL` e permanece uma falha bloqueadora do gate, inclusive no cleanup final; existe regressão automatizada para o caminho bloqueado.
- `F12-IMPORT-R5-001`: **RESOLVED**. Central/F4/F5, tenant directory, transações tenant, F12, pg-boss, outbox/inbox e relay são compostos em `backend/src/config/opportunityImportWorkerInfrastructure.js`. O único módulo externo selecionável é F11 e possui contrato fechado a `documentPortFactory` e `close`.
- Fixture UBI reconciliada: criação idempotente da role técnica antes da migration 015 e verificação dos atributos canónicos, sem memberships adicionais. ACL mínima, cadeia transitiva fail-closed e hook de commit incerto com limpeza por rollback permanecem cobertos.
- Migration 015: up `58ecebd8c4dd726bd7f65d4ec16adebab44bc3a838ca8177ef486e983c7ba509`; down `a9ea1f4389eccbe76ed94a8fdd98e8bedd92596d78ff18b93dc86dedef008f6b`; fingerprint `8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac`.
- Commits locais existentes: baseline `e5a22590a008d5e93a17b8a4c07eb1e7d887ddfb` e importação XLSX `6c0be3af7001f4f8b46aede5320d5daf8b8e4e8c`. Este documento regista o fecho restrito da importação XLSX F12. Nenhum push, PR ou deploy foi executado.
- Este fecho não valida staging, produção, rollout, fornecedores externos, Layer C/F11 externo, IdP externo ou dados UBI reais. CSV como fonte e migração de dados reais ficam fora do âmbito; CSV é apenas relatório F11. F13 integral permanece `In Progress`.
- Antes de uma amostra UBI real continuam por aprovar: ficheiro/folha sanitizados e autorização de tratamento; headers e colunas a mapear/preservar/ignorar; política determinística de duplicados/conflitos; catálogos e mappings admitidos; concorrência, retry, quotas e prazos de reconciliação; retenção/legal hold do original, relatórios e outcomes; Layer C F11/provider/scan externos e execução no ambiente alvo. O gate local não valida IdP externo, staging, produção ou rollout.
- Decisão humana de fecho: **GO restrito**. A importação F12 fica documentalmente concluída apenas no âmbito local autorizado. Staging, produção e rollout permanecem explicitamente não validados e exigem gates e autorização próprios.

### Baseline Draft histórico (substituído onde o contrato aprovado acima divergir)

### Formatos considerados no Draft

- Excel Open XML `.xlsx`, sem macros. Fórmulas, ligações externas, objetos embebidos e conteúdo executável nunca são executados; a política final de rejeição por célula/ficheiro requer aprovação antes de `Ready`.
- CSV em UTF-8, com BOM opcional, campos quoted segundo o formato CSV e delimitador vírgula ou ponto e vírgula. Encoding, delimitador e header inferidos têm de ser apresentados no preview e confirmados; nunca são aplicados silenciosamente quando ambíguos.
- `.xls`, `.xlsm`, `.xlsb`, ODS, JSON, XML, ZIP genérico e documentos protegidos por password ficam fora deste Draft.
- Qual destes formatos entra primeiro, e a política de folhas do XLSX, continuam decisões de produto pendentes.

### Colunas e mapeamento

O destino é o snapshot funcional F12 v1. Os nomes abaixo são colunas canónicas, não aliases aprovados de uma fonte real.

| Classe | Colunas canónicas | Regra Draft |
| --- | --- | --- |
| Obrigatórias | `title`, `funderName` | Linha sem ambas válidas é rejeitada. |
| Opcionais | `summary`, `programmeName`, `callReference`, `officialUrl`, `openingDate`, `closingDate`, `eligibilitySummary`, `thematicCodes`, `territoryCodes`, `beneficiaryTypeCodes`, `fundingAmountMin`, `fundingAmountMax`, `currencyCode`, `externalIdentifier`, `sourceUrl` | Só são aceites quando mapeadas explicitamente e validadas pelo contrato F12. |
| Geradas pelo servidor | IDs, `organizationId`, tenant, actor, membership, provenance ID, timestamps, schema/rule versions, lifecycle, validation state, revisão e row version | Nunca vêm do ficheiro. |
| Ignoradas | colunas não mapeadas que o utilizador marque explicitamente como ignoradas no preview | A lista e os headers ignorados entram no digest do mapeamento e no relatório. |
| Proibidas | credenciais, tokens, connection strings, SQL, HTML ativo, payload JSON livre, dados pessoais/contactos, IDs técnicos de tenant/organização/actor, permissions, roles e infraestrutura | O ficheiro/mapeamento falha fechado; não são apenas ignoradas. |

Headers desconhecidos não são descartados silenciosamente: têm de ser mapeados, marcados explicitamente como ignorados ou causar recusa da confirmação. A importação não cria colunas, campos ou catálogos novos.

### Tipos, limites e normalização

- `title`: texto NFC/trim, 1–300 caracteres; `funderName`: 1–200.
- `summary` e `eligibilitySummary`: até 4 000 caracteres; `programmeName`: até 200; `callReference`: até 128; URLs: até 2 048.
- Listas temáticas, territoriais e de beneficiários: no máximo 32 códigos cada, usando apenas catálogos/versionamentos aprovados. Separador e aliases da fonte permanecem por decidir.
- Datas são datas civis ISO `YYYY-MM-DD`, sem conversão de timezone; quando ambas existem, `closingDate >= openingDate`. Formatos de entrada alternativos e locale não são inferidos silenciosamente e dependem de mapeamento aprovado.
- Montantes são decimais canónicos, sem arredondamento silencioso. `fundingAmountMin`, `fundingAmountMax` e `currencyCode` obedecem às constraints F12, com `min <= max`; moeda é ISO 4217 explícita, nunca EUR por defeito.
- Normalização e digests reutilizam as versões F12 aprovadas. O original allowlisted e a representação normalizada permanecem distintos; células vazias não se tornam zero, `false`, data ou código desconhecido.
- Limites exatos de bytes, linhas, colunas, jobs concorrentes por organização e concorrência global são obrigatórios antes de `Ready`, mas ainda não estão aprovados.

### Identidade, idempotência e proveniência

- O ficheiro é identificado pela versão documental F11 e por SHA-256 dos bytes exatos. Um ficheiro substituído é uma nova versão, nunca overwrite.
- O mapeamento confirmado tem versão e digest próprios, incluindo folha, header, aliases, delimitador/encoding, colunas ignoradas e versões dos catálogos/regras.
- O job tem request/idempotency key e digest da intenção que vincula organização, versão F11, digest do ficheiro, mapeamento e operação. Mesma key com digest diferente falha fechado.
- Cada linha conserva identidade reproduzível dentro da versão do ficheiro: folha/stream, número físico da linha e digest canónico da projeção allowlisted. `externalIdentifier`, quando existir, continua sujeito ao namespace de proveniência aprovado e não substitui a identidade da linha.
- A proveniência da oportunidade inclui referência opaca ao documento/versão F11, digest do ficheiro, linha/folha, digest da linha, versão do import contract/mapeamento, job e importador resolvido server-side. F7 e F10 não recebem conteúdo integral da linha ou do ficheiro.
- Retry/replay reautoriza membership, organização, F5 e acesso F11 atuais. Não duplica oportunidade, revisão, evento ou resultado da linha.

### Criação, duplicados e conflitos

- Uma linha aceite cria apenas uma oportunidade privada no tenant da organização ativa. `organizationId`, tenant e authority nunca são inputs do ficheiro ou do cliente.
- A escolha entre `DRAFT` e `ACTIVE/PENDING_REVIEW` como estado inicial é decisão pendente; não pode ser inferida do ficheiro.
- Duplicados usam as regras determinísticas e versionadas F12: `EXACT`, `POSSIBLE` ou `DISTINCT`, com explicação dos campos/regras usados.
- `POSSIBLE` exige revisão humana e nunca produz merge, link, update ou criação automática. A decisão e o actor ficam auditados.
- Para `EXACT`, a classificação é automática, mas a ação de produto — rejeitar, ignorar, relacionar ou propor update — permanece pendente. Nenhuma opção pode apagar proveniência ou histórico.
- Colisão com oportunidade existente, external identifier, URL ou referência incompatível produz conflito explícito. O import nunca sobrescreve por título, row number ou heurística.
- Valores de catálogo desconhecidos são rejeitados ou enviados para resolução humana conforme política ainda a aprovar; nunca criam silenciosamente financiadores, programas, territórios, temas ou beneficiários.

### Processamento assíncrono F9

- O upload/preview não cria oportunidades. Depois da confirmação autorizada, a API regista a intenção/outbox e o worker F9 processa o job com entrega pelo menos uma vez, inbox/idempotência, fencing, retries limitados e reconciliação.
- Estados de domínio propostos: `UPLOADED`, `VALIDATING`, `READY_FOR_CONFIRMATION`, `QUEUED`, `RUNNING`, `CANCELLATION_REQUESTED`, `CANCELLED`, `COMPLETED`, `COMPLETED_WITH_ISSUES`, `FAILED` e `RECONCILIATION_REQUIRED`. O mapeamento exato para estados internos F9 deve ser fechado no plano.
- Cancelamento é autorizado e cooperativo. Impede novas linhas após ser observado, mas não desfaz linhas já confirmadas; o relatório distingue efeitos concluídos, não iniciados e incertos.
- Retry só ocorre para classes F9 retryable e com a mesma intenção. Retry manual/replay exige F5 atual, conserva lineage/idempotência e não transforma erro permanente ou conflito em sucesso.
- Erro estrutural de ficheiro/mapeamento antes da confirmação produz zero oportunidades. Durante a execução, cada linha é uma unidade transacional independente: mutação, proveniência, resultado idempotente e F7 crítico fazem commit ou rollback juntos.
- Falhas parciais não revertem linhas já concluídas nem ocultam rejeições. Commit incerto é reconciliado pelo estado persistido e digest da linha antes de qualquer retry; nunca se presume rollback nem se cria outra oportunidade às cegas.

### Autorização, auditoria e isolamento

- F5 terá permissions distintas para upload/preview, confirmar/arrancar, consultar, cancelar/repetir, rever correspondências e arquivar job/relatório. Os códigos, resources, scopes, MFA/SoD e bundles concretos são decisões a aprovar; não há grants implícitos por role.
- F7 crítico acompanha confirmação do job, criação/decisão por linha, cancelamento, retry/replay, decisão humana e arquivo. Eventos contêm identidade confiável, organização, operação, versões/digests e correlation/causation allowlisted, sem conteúdo do ficheiro, títulos, URLs, montantes, PII ou secrets.
- Listagem, detalhe, preview, relatório, ficheiro e correspondências são sempre organization-scoped. A mesma identidade ou UUID noutra organização não revela existência, contagens, estado ou timing distinguível.
- Membership revogada/stale, organização inelegível, tenant incompatível, documento inacessível ou autoridade alterada bloqueiam novas ações e efeitos. Resultados já persistidos permanecem históricos e sujeitos a autorização atual.

### F11, retenção e arquivo

- O ficheiro original entra pela abstração F11 como documento privado tenant-local. Processamento só começa quando a versão está no estado F11 aprovado e limpa; não há filesystem, bucket/key, URL ou scanner fornecido pelo caller.
- Preview e relatórios que sejam artefactos descarregáveis usam F11 e referências opacas. URLs temporários são emitidos apenas após autorização atual.
- Ficheiro, job, relatório e decisões são arquivados logicamente; não existe DELETE funcional ou eliminação automática neste Draft.
- Prazos de retenção, legal hold, acesso posterior ao original e retenção diferenciada de aceites/rejeitados continuam decisões obrigatórias antes de implementação.

### Relatório e contrato mínimo de UI

- O relatório apresenta totais e lista paginada de `aceite`, `rejeitado`, `duplicado exato`, `candidato incerto`, `conflito`, `cancelado/não processado` e `incerto/em reconciliação`, com código de razão fechado por linha e sem expor dados de outra organização.
- O relatório liga cada resultado à linha/folha original e, quando autorizado, ao UUID/revisão criada; não altera o resultado ao ser descarregado novamente.
- UI mínima: escolher ficheiro; mostrar organização ativa; upload e estado F11; selecionar folha/delimitador quando aplicável; mapear ou ignorar explicitamente colunas; preview bounded com erros; confirmar resumo/efeitos; mostrar progresso e contagens; cancelar/repetir quando autorizado; rever candidatos incertos; filtrar e descarregar relatório.
- Estados loading, vazio, ficheiro inválido, 400, 401, 403/404 uniforme, 409, 413/limite, 422/linhas inválidas, 503/indisponibilidade e commit incerto devem ter mensagens controladas. A UI não decide permissões por `ADMIN`/`PROFESSOR` nem fabrica moeda, tenant, organização ou catálogos.

### Critérios de aceitação Draft

1. Formato, mapping e preview são explícitos, versionados e não produzem efeitos antes de confirmação autorizada.
2. Apenas colunas F12 allowlisted chegam à normalização; extras, tipos e limites falham fechado ou são ignorados apenas por decisão explícita registada.
3. Ficheiro, job e linha têm identidades/digests estáveis; redelivery, retry e commit incerto produzem um único efeito lógico.
4. Cada oportunidade criada é privada e pertence exclusivamente à organização ativa resolvida no servidor.
5. Organizações A/B não descobrem ficheiros, jobs, previews, contagens, linhas, oportunidades, candidatos ou relatórios uma da outra.
6. Duplicado exato, candidato incerto e conflito são classes distintas; incerteza nunca cria merge ou catálogo automaticamente.
7. F5 é deny-by-default e reautorizado em confirmação, execução sensível, cancelamento, retry, revisão e acesso ao relatório/ficheiro.
8. Efeito da linha, proveniência, idempotência e F7 crítico são atómicos; falha parcial e commit incerto são reportados e reconciliados.
9. F9 executa fora da API, com cancelamento cooperativo, retry limitado, fencing, dead-letter/reconciliação e sem autoridade fornecida pelo payload.
10. F11 conserva o original e relatórios privados, sem fallback filesystem/provider e sem eliminação automática.
11. O relatório é completo, reproduzível, paginado e distingue aceites, rejeitados, duplicados, conflitos e estados incertos.
12. A UI cobre upload, preview/mapping, confirmação, progresso, revisão humana e relatório sem decisões por role global.
13. Arquivo é lógico; não existe DELETE/hard delete de oportunidade, ficheiro, job ou relatório no fluxo funcional.
14. Testes futuros usam apenas ficheiros, organizações, actors e oportunidades sintéticos; nenhuma prova depende de dados UBI reais ou conectores.

### Fora do âmbito

- Execução ou implementação da importação, migrations, catálogos, permissions, eventos, jobs, UI ou configuração.
- Dados UBI reais, migração legacy, conectores externos e sincronização de fontes.
- Matching, qualificação e candidaturas.
- Inferência/fuzzy matching, decisão automática sobre candidatos incertos ou merge destrutivo.
- Criação silenciosa de financiadores, programas, territórios, temas, tipos de beneficiário ou qualquer outro catálogo.

### Decisões de produto ainda necessárias

1. Primeira fonte, formato ativado e variante concreta: XLSX/CSV, folhas, delimitador, encoding e regras para fórmulas.
2. Colunas reais a preservar, headers/aliases, separadores de listas, campos específicos da fonte e exemplos sintéticos aprovados.
3. Estratégia para `EXACT`, conflitos com oportunidades existentes e workflow/permissions para `POSSIBLE`.
4. Catálogos e mapeamentos permitidos, governance de aliases e tratamento de códigos desconhecidos, sem criação silenciosa.
5. Lifecycle/validation inicial e momento exato da criação: confirmação global, por linha ou após revisão.
6. Limites operacionais: bytes, linhas, colunas, preview, ficheiros/jobs simultâneos, concorrência por organização/global, timeout e quotas.
7. Retenção do original, versões, previews, relatórios, eventos e resultados por linha; legal hold e acesso após arquivo.
8. Matriz F5 completa, MFA/SoD, catálogo F7 e reason codes do relatório.
9. Política de cancelamento/retry perante efeitos parciais e prazo operacional para reconciliação de resultados incertos.
10. Conteúdo e formato descarregável do relatório, incluindo eventual CSV/XLSX e campos que podem ser apresentados por linha.

As decisões do primeiro MVP listadas no contrato aprovado acima já foram tomadas. Permanecem pendentes apenas as decisões de produto necessárias para uma amostra UBI real e eventual CSV/rollout; este histórico não rebaixa a feature para `Draft`.

## Questões em aberto do catálogo

- Selecionar os conectores efetivos do primeiro lançamento após validação de APIs, feeds, ficheiros oficiais, permissões e estabilidade; conectores não fazem parte desta importação XLSX.
