# Correções GET/POST e desempenho — 26/10/2026

Implementação concluída no worktree, em **Review**. Sem commit, merge, push ou deploy. A validação local não substitui a prova HTTP/OIDC com a composição produtiva.

## Baseline e preservação

- HEAD: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; branch: `feat/f13-organizational-profile`.
- 2078 entradas iniciais de estado; 2531 ficheiros existentes com SHA-256 em [baseline.json](baseline.json). O repositório já estava extensamente alterado.
- [changed-files.json](changed-files.json) identifica exclusivamente os ficheiros alterados/adicionados neste trabalho e respetivos hashes; [preservation.json](preservation.json) confronta os ficheiros anteriores com o baseline. Nenhum ficheiro anterior foi eliminado.
- Nenhuma migration, incluindo 028–030, grant, catálogo de permissões, configuração de deploy ou ficheiro de dados Dev foi alterado. Não foram executados scripts de migração/provisioning, nem comandos de escrita nas bases Dev. As provas SQL usam apenas tabelas temporárias por ligação na base local `postgres`, encerradas no final.

## Causas e correções

| Problema / causa raiz | Correção e localização |
| --- | --- |
| GET sem prazo participava numa espera ilimitada anterior à rotação | [requestConcurrency.js:7](../../../frontend/src/api/requestConcurrency.js:7): registo de AbortController por pedido, cancelamento de leituras anteriores e drenagem de 250 ms. Pedidos independentes continuam concorrentes; novas admissões aguardam apenas a transição. Leituras que ignoram abort deixam de ficar retidas. Escrita em curso faz a mudança falhar com `SESSION_BUSY`; nunca é repetida nem atravessada pela rotação. |
| Ausência de limites gerais de transporte | [api.js:38](../../../frontend/src/api/api.js:38): leituras 15 s, escritas 30 s por defeito; CSRF/rotação 10 s; matching 60 s, relatório 30 s e uploads de documentos 10 min conservados. Os limites específicos já definidos continuam aplicáveis. |
| POST de organização era seguido de GET obrigatório | [AuthContext.jsx:37](../../../frontend/src/contexts/AuthContext.jsx:37) aplica diretamente utilizador/organização devolvidos; [api.js:155](../../../frontend/src/api/api.js:155) guarda o token devolvido antes de libertar a barreira. A geração local continua a rejeitar respostas anteriores. |
| Token inválido persistia em cache | [api.js:24](../../../frontend/src/api/api.js:24) e [api.js:60](../../../frontend/src/api/api.js:60): cache com geração, obtenção partilhada do token, invalidação perante `403/CSRF_INVALID` e um retry máximo. A lease e o sinal permanecem os mesmos durante o retry; erros de rede, timeout ou outros 403/503 não repetem comandos. |
| Importação lia `body.decision` sem validar | [privateOpportunityImportRoutes.js:29](../../../backend/src/routes/privateOpportunityImportRoutes.js:29): objeto exato, decisão CREATE/REJECT e linha válida; ausência, null, array ou JSON inválido produzem `400 INVALID_INPUT`. |
| Código público derivava de `error.message` | [httpErrors.js:1](../../../backend/src/opportunityImports/httpErrors.js:1) define códigos fechados; erros de domínio usam `.code`. [privateOpportunityImportRoutes.js:10](../../../backend/src/routes/privateOpportunityImportRoutes.js:10) limita detalhes e emite diagnóstico sanitizado; imprevistos resultam em `503 IMPORT_UNAVAILABLE`. O handler global normaliza CSRF e erros de parsing das importações. |
| CSV ignorava `write(false)` e tentava JSON depois de começar | [privateOpportunityImportRoutes.js:39](../../../backend/src/routes/privateOpportunityImportRoutes.js:39) aguarda `drain`, trata `close/error`, e fecha o transporte após início. Antes do primeiro byte, remove os headers CSV e responde JSON seguro. |
| Browse fazia scan de até 10000 linhas e autorização remota por linha | [browseSql.js:9](../../../backend/src/applications/browseSql.js:9) aplica organização, equipa, permissões, referências, pesquisa, contagens, ordenação e paginação no PostgreSQL. Usa a coluna `central_opportunity_id`. [readAuthority.js:8](../../../backend/src/applications/readAuthority.js:8) compila o snapshot central usando o mesmo policy engine. Autoridade, nomes e capacidade de transição são carregados por lote; detalhe limitado a 25 linhas. |
| Relatório reutilizava a lista integral | [reportSql.js:18](../../../backend/src/applications/reportSql.js:18) calcula métricas/estados/unidades em SQL e pagina o detalhe. Fingerprint SHA-256 de todo o conjunto autorizado vincula páginas e exportação, incluindo nomes e unidade. O guard coordenado e a auditoria crítica da exportação mantêm-se. |
| Dashboard descarregava todas as páginas das três fontes | [organizationDashboardRoutes.js:18](../../../backend/src/routes/organizationDashboardRoutes.js:18) implementa `GET /organizations/:organizationId/dashboard/summary`, com agregados nas respetivas bases. Valida a organização e revalida no fim as permissões de candidatura, oportunidades e diretório utilizado. [api.js:182](../../../frontend/src/api/api.js:182) faz um pedido. [DashboardReport.jsx:23](../../../frontend/src/components/DashboardReport.jsx:23) carrega páginas de detalhe sem recalcular totais no browser. |
| Matching consultava o detalhe de cada pessoa | [matching.js:32](../../../backend/src/organizationDirectory/matching.js:32) usa `peopleWithResearchAreas`; [organizationDirectory/repository.js:63](../../../backend/src/organizationDirectory/repository.js:63) junta áreas à página em uma consulta. Mantém limite, classificação, ordem e revalidação final. A otimização histórica documentada abrangia apenas oportunidades privadas. |

Os módulos de composição, contratos, router e catálogo central foram ligados aos novos percursos. A lista exaustiva, incluindo os testes e os scripts de benchmark, está no manifesto de ficheiros acima. As referências indicam os pontos de implementação; o diff Git global também contém trabalho anterior do utilizador e não representa este recorte.

## Verificação executada

| Verificação | Resultado / evidência |
| --- | --- |
| Sessão/CSRF/AuthContext iniciais | 12/12; [frontend-focused.log](frontend-focused.log) |
| Importação/parser/workflow iniciais | 26/26; [backend-import-focused.log](backend-import-focused.log) |
| Backend final focado, incluindo PostgreSQL real em tabelas temporárias | **36/36**, sem skips; [backend-focused-final.log](backend-focused-final.log) |
| Suite frontend | **337/337**, 54 ficheiros; [frontend-suite-final.log](frontend-suite-final.log) |
| Regressão final do coordenador após libertação de listeners | **11/11**; [frontend-session-final.log](frontend-session-final.log) |
| Suite backend | **1240 PASS / 3 FAIL / 7 SKIP**, 1250 testes; [backend-suite-final.log](backend-suite-final.log). Os sete testes SQL opcionais foram executados separadamente e passaram. |
| Build Vite final | **PASS**; [frontend-build-final.log](frontend-build-final.log) |
| `node --check` | **39 ficheiros / zero falhas**; [syntax-result.json](syntax-result.json) |

Testes novos: `HttpSessionFlows.test.jsx`, `httpImportSafety.test.js`, `httpReadAuthority.test.js`, `httpBrowseSql.test.js` e `httpDashboardSummary.test.js`. Testes existentes foram adaptados para testar o novo contrato SQL, a resposta POST autoritativa, a paginação do relatório e a chamada em lote do matching. A prova SQL inclui duas organizações, equipa removida, pré-qualificação não autorizada, pesquisa por nome, precisão decimal, cursores falsificados/desatualizados, 10000 candidaturas, mudança de unidade e falha de auditoria. A prova de política compara os seletores compilados com o autorizador existente para os quatro perfis.

As três falhas backend são anteriores e estão documentadas em `context/features/request-concurrency-phase-1.md`:

- `f11RealTransportAdapters`: cancelamento ClamAV não fecha o transporte no prazo do teste.
- `f12Composition`: fixture F11 incompatível com o contrato corrente de ObjectStoragePort.
- `f5AuthorityCommitGuard`: catálogo fechado de SQL não corresponde à função fixada no teste.

Não foram corrigidas neste recorte. Os seus ficheiros e dependências diretas afetadas pelas mensagens de erro conservaram o hash inicial. As primeiras tentativas dos runners falharam em `spawn EPERM` dentro da sandbox; os testes foram depois executados com a autorização automática de subprocessos.

## Medições

Matching: ensaio em processo com doubles, quatro execuções concorrentes, 20 amostras por volume, um `setImmediate` por chamada de diretório. Medido antes de alterar o matching e repetido depois, sem alterar o cenário. Não é latência HTTP nem custo de PostgreSQL/OIDC. [Antes](benchmark-before.json), [depois](benchmark-after.json), script `backend/scripts/benchmarkHttpFlows.js`.

| Pessoas | Chamadas ao diretório antes → depois | Detalhes individuais antes → depois | p50 ms antes → depois | p95 ms antes → depois |
| --- | --- | --- | --- | --- |
| 25 | 28 → 3 | 25 → 0 | 24,95 → 13,79 | 31,82 → 16,23 |
| 250 | 262 → 12 | 250 → 0 | 161,16 → 102,23 | 189,06 → 130,78 |
| 1000 | 1042 → 42 | 1000 → 0 | 530,91 → 439,97 | 693,71 → 579,13 |

PostgreSQL após alteração: quatro ligações reais, tabelas temporárias separadas, 20 amostras depois de aquecimento. Autoridade simulada; exclui custo do guard central e HTTP/OIDC. Não existe medição SQL anterior comparável, pelo que não é declarada uma percentagem de ganho. [Resultados](benchmark-sql-after.json), script `backend/scripts/benchmarkHttpSql.js`.

| Candidaturas | Browse p50 / p95 ms | Relatório p50 / p95 ms | Linhas de detalhe / consultas por pedido |
| --- | --- | --- | --- |
| 25 | 3,82 / 5,24 | 5,89 / 6,66 | 25 / 1 |
| 1000 | 12,17 / 12,57 | 13,92 / 14,53 | 25 / 1 |
| 10000 | 94,88 / 109,27 | 106,11 / 110,92 | 25 / 1 |

Com 10000 candidaturas, a resposta browse medida tem 17451 bytes e a do relatório 18404 bytes. A quantidade de consultas e detalhe materializado está limitada; contagens e fingerprint ainda examinam o conjunto autorizado no servidor. Não se afirma custo SQL constante em função do total.

## Limites e riscos pendentes

- Falta medir a composição completa HTTP/OIDC e fazer uma prova com os roles/RLS produtivos e revogação concorrente entre bases. Não foram executados gates que apliquem migrations, grants ou fixtures Dev. Não há alegação de SLO nem de ganho produtivo.
- As três falhas globais continuam a impedir uma suite backend totalmente verde.
- A ordenação textual passa a ser `lower(...)` com a collation da base, em vez de `localeCompare('pt', {sensitivity:'base'})`; casos de acentos/pontuação podem ter uma ordem diferente. Desempates usam sempre o ID. Nenhuma collation foi criada ou modificada.
- Exportação integral conserva os limites anteriores de 10000 linhas/900 KB e valida o digest antes da auditoria; não foi convertida para exportação assíncrona. A consulta normal e o dashboard já não transportam o conjunto completo.
- Agregados e digests custam O(total autorizado) no PostgreSQL. Sem novas migrations/índices, a medição com dados e planos reais continua necessária. O lote de nomes tem limite de 10000 memberships e o diretório de 1000 unidades.
- O dashboard mostra até 25 prazos, com indicação do total quando há mais, e dez oportunidades; o detalhe de candidaturas está paginado. Números globais nunca são calculados a partir destas listas limitadas.
- Os novos percursos pressupõem o esquema corrente das candidaturas, com origem central, orçamento e lifecycle já disponíveis; não há migração automática nem fallback para o piloto.

Próximo passo registado no fecho da implementação: validar HTTP/OIDC e roles/RLS numa instalação isolada com o schema corrente, antes de produção, sem alterar o ambiente Dev.

Atualização de 26/10/2026: essa [validação foi executada](../http-oidc-isolated/README.md). O cliente e o isolamento SQL passaram nos cenários exercitados, mas o gate integrado está reprovado por incompatibilidade do leitor com o schema corrente e falhas de autoridade no relatório concorrente. As medições em processo/tabelas temporárias acima continuam a ser evidência restrita, não desempenho produtivo.
