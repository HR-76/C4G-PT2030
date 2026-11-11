# Correções da auditoria de qualidade — primeiro incremento

Estado: Review — 27/10/2026. [Contrato](../../features/code-quality-audit-corrections.md).

## Resultado

Implementadas correções pequenas de HTTP, observabilidade de fronteira, acessibilidade, cancelamento, concorrência de health checks, volume de parceiros e documentação. Sem refatoração global, mudança de autorização ou promessa de capacidade produtiva. A auditoria global continua com trabalho pendente listado abaixo.

Branch inicial/final `feat/f13-organizational-profile`; HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`. Worktree inicial com 2531 entradas; nenhuma alteração anterior foi revertida. Baseline de metadados de 30908 ficheiros guardada antes de editar em `%TEMP%/c4g-fixes-20261027-baseline.json`.

## Correções e compatibilidade

| Incremento | Resultado | Contrato preservado |
| --- | --- | --- |
| Registo de entidade | PUT com query inesperada devolve 400/INVALID_INPUT antes de ler/gravar | Pedidos válidos e autorização existentes |
| Oportunidades | Allowlist de códigos públicos; erros desconhecidos tornam-se 503/OPPORTUNITY_UNAVAILABLE | Todos os códigos/status de domínio anteriores |
| Observabilidade | Ramos globais antes silenciosos e routers de candidaturas/oportunidades emitem diagnóstico público sanitizado; erro do observador não altera resposta | Formatos HTTP existentes; parser/oversize tratados como input; sem payload, SQL, mensagem interna ou credenciais |
| Correlação | Respostas de candidaturas e ramos globais com correlationId reutilizam contexto operacional quando existe | Campo existente, com UUID de fallback |
| Confirmação | Papel/nome/descrição acessíveis, foco inicial em Cancelar, Tab/Shift+Tab contidos, Escape e restauro; promessas pendentes resolvidas false no unmount/substituição | Confirmar/cancelar e consumidores existentes |
| Leituras | Sinais nas leituras do sino e Matching; cancelamento no unmount/substituição, incluindo páginas do seletor | POST refresh sem nova repetição/cancelamento, estado obsoleto descartado |
| Health | Uma execução por dependência partilhada; timeout envia AbortSignal; probe não cooperante não se sobrepõe a novas execuções até terminar | Estados readiness, falhas em cache e recuperação |
| Parceiros | Exatamente 10000 candidatos aceites no teste de repositório; lookahead LIMIT 1 recusa 10001 antes de autorizar overflow | Totais, pesquisa, ordem, cursor/digest e autorização por candidato |
| Digest de parceiros | Hash incremental evita aplicar limite material de 256 KiB à lista completa | Mesmos bytes de canonicalização, inclusive profundidade; limites de comandos/registos e canonicalizador partilhado intactos |
| Documentação | Comandos atuais de testes/build e separação dos gates de infraestrutura | Sem alterar regras de acesso ou operações autorizadas |

A observação HTTP acrescentada conta/correlaciona falhas com códigos genéricos. Não constitui diagnóstico completo da causa raiz; hooks diagnósticos de composição continuam separados. Os callbacks de produção de DB/catálogo/documentos ainda não propagam AbortSignal ao transporte: a correção de health impede sobreposição ilimitada, não demonstra cancelamento físico de queries.

## Testes antes da implementação

- Frontend: 9 novas regressões falharam; 21 testes existentes passaram no recorte. Após a implementação, 30/30 e depois 59/59 com consumidores de oportunidades/parceiros.
- HTTP: seis regressões iniciais falharam; a sétima de correlação também foi demonstrada antes da alteração respetiva. Depois: 49/49 no recorte HTTP.
- Health: 1 PASS/4 FAIL antes; 18/18 depois com observabilidade existente.
- Parceiros: 1 PASS/2 FAIL antes da correção de fronteira. A correção revelou falha adicional do digest de listas acima de 256 KiB; 3 PASS/1 FAIL antes de alterar o digest. Depois: 6/6 com contratos existentes; compatibilidade reforçada com Unicode NFC, escapes e pessoas aninhadas.

São **25 novos testes**: 16 backend (7 HTTP, 5 health, 4 parceiros) e 9 frontend (5 diálogo, 2 sino, 2 Matching). Dois testes HTTP antigos foram adaptados à nova observação sanitizada de erros inesperados, conservando expectativas de parser, formato e ausência de informação sensível. Testes de argumentos frontend incorporam o sinal adicional.

## Validação completa

| Verificação | Baseline desta execução | Após correções |
| --- | --- | --- |
| Frontend npm test | 337 PASS, 54 ficheiros | 346 PASS, 55 ficheiros |
| Backend npm test | 1298 PASS / 3 FAIL / 7 SKIP | 1314 PASS / 3 FAIL / 7 SKIP |
| Frontend npm run build | Não executado antes | PASS |
| Backend node --check | — | PASS, 12 ficheiros alterados de código/testes |

As três falhas backend foram reproduzidas antes de qualquer alteração funcional e permaneceram as mesmas:

1. `test/f11RealTransportAdapters.test.js:209`: cancelamento ClamAV não observa fecho do stream/socket no prazo esperado.
2. `test/f12Composition.test.js:20`: double de ObjectStoragePort incompleto.
3. `test/f5AuthorityCommitGuard.test.js:18`: divergência do catálogo SQL face à função fixada.

A suite backend **não está verde**. Os sete skips continuam explícitos. Não corrigimos essas falhas fora do âmbito nem removemos verificações. As primeiras tentativas de suites no sandbox falharam por subprocessos indisponíveis (EPERM); as execuções com subprocessos permitidos produziram os resultados da tabela. Testes HTTP usam servidores efémeros em loopback com doubles, não a aplicação/Dev. Nenhum gate PostgreSQL/Keycloak foi iniciado.

Evidência de execução: `%TEMP%/c4g-fixes-{backend,frontend}-{before,after}.log`, `%TEMP%/c4g-fixes-build-after.log`, `%TEMP%/c4g-audit-http-{red,green}.log` e `%TEMP%/c4g-frontend-regressions-{red,green}.log`. Resultados consolidados e preservação em [verification.json](verification.json).

## Medições e limites

| Cenário isolado | Antes | Depois |
| --- | --- | --- |
| 20 leitores concorrentes de readiness, mesma dependência | 20 probes | 1 probe |
| Parceiros: 10000 candidatos | LIMIT_EXCEEDED; revelada limitação de digest após corrigir fronteira | Página de 25, total 10000 e cursor seguinte consistente no double |
| Parceiros: 10001 candidatos | Recusa sem distinguir de 10000 | Recusa após uma consulta adicional LIMIT 1; overflow não autorizado |

Contagem de probes reduzida em 95% neste cenário determinístico. Não é medição de latência produtiva. Parceiros continuam O(N) na seleção/autorização/digest e materializam o conjunto; a correção elimina dois erros de fronteira, não resolve a paginação integral. Os tempos dos testes não são benchmark de desempenho. Nenhum SLO C6 foi repetido nem alterado.

## Ficheiros alterados neste incremento

- Backend runtime: `src/app.js`, `src/productionComposition.js`, `src/routes/platformDirectoryRoutes.js`, `src/routes/privateOpportunityRoutes.js`, `src/routes/applicationSliceRoutes.js`, `src/observability/health.js`, `src/applications/partners.js`.
- Backend testes novos: `test/auditHttpCorrections.test.js`, `test/healthConcurrency.test.js`, `test/partnerBrowseBoundary.test.js`; adaptados: `test/f13EditorialRecovery.test.js`, `test/f13Pq1HttpBoundary.test.js`.
- Frontend runtime: `src/components/ConfirmDialog.jsx`, `src/components/Layout/Header.jsx`, `src/pages/Organization/MatchingWorkspace.jsx`.
- Frontend testes: novo `src/components/ConfirmDialog.test.jsx`; adaptados `src/pages/Notifications.test.jsx`, `src/pages/Organization/MatchingWorkspace.test.jsx`.
- Contexto: `AGENTS.md`, `context/coding-standards.md`, `context/current-work.md`, `context/features/code-quality-audit-corrections.md`, este relatório e `verification.json`.
- Artefactos esperados das validações: `frontend/dist/` regenerado pelo build e cache local do Vitest. Sem instalação de dependências ou alteração de lockfiles.

Revisão independente dos incrementos frontend, health, HTTP e parceiros não encontrou regressões acionáveis. A sugestão de reforçar a compatibilidade de digest com Unicode/dados aninhados foi incorporada. Testes DOM não equivalem a prova WCAG integral com browser/leitor de ecrã.

## Pendências delimitadas

- Paginação SQL integral de parceiros/alertas: requer equivalência de seleção, autorização, auditoria, contagens, ordenação e validade do cursor. Não trocar essas propriedades silenciosamente por uma otimização. Registar contrato e provas PostgreSQL isoladas antes do incremento.
- Matching: limites e resultados integrais de 1000 itens por fonte são explícitos no contrato anterior; seletor pesquisável/paginado e mudança de resultados exigem especificação funcional. Cancelamento corrigido; capacidade não aprovada.
- RFC 9457: migração global do envelope HTTP permanece por especificar com compatibilidade cliente/servidor. O incremento preserva os envelopes atuais.
- Observabilidade: genérica e correlacionada nos ramos corrigidos, não uniformizada em toda a aplicação; cancelamento físico de probes depende dos adaptadores.
- Falhas backend anteriores, prova WCAG no navegador, capacidade produtiva e SLO C6 continuam pendentes.

## Preservação

Nenhuma migration, grant/permissão, configuração/dado Dev ou deploy foi alterado. Não houve acesso a bases Dev, pausa de serviços, commit, merge ou push. A conferência de metadados identifica apenas fontes/documentação previstas, artefactos de build/cache e a evidência nova; não é snapshot dos dados externos nem hash integral do repositório.
