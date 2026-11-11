# Concorrência de pedidos — fase 1

Estado: **Review** (2026-10-26).

## Objetivo

Eliminar a serialização global de pedidos no browser e o advisory lock organizacional das leituras de candidaturas, preservando autenticação, autorização, isolamento multi-organização, contratos HTTP e garantias de consistência dos comandos.

## Política aprovada

- Leituras independentes e pedidos dirigidos a uma organização explícita podem decorrer em paralelo.
- Operações dependentes do contexto implícito da sessão usam uma barreira: decorrem em paralelo entre si, mas uma alteração de organização espera pelo trabalho anterior e o trabalho posterior espera pela alteração.
- Alterações de contexto são serializadas pela ordem de admissão.
- Uploads não participam na barreira e conservam o timeout específico de dez minutos.
- Cancelamento é propagado por `AbortSignal` nas leituras alteradas; respostas obsoletas não atualizam componentes desmontados ou substituídos.
- Leituras semânticas de candidaturas não adquirem o advisory lock `APPLICATION:<organization>`.
- Comandos mantêm o lock organizacional nesta fase. Reduzir o lock para candidatura/agregado exige prova específica para comandos sem `applicationId`, notificações e efeitos transversais.

## Critérios de aceitação

1. Não existe uma fila global que serialize todos os pedidos HTTP.
2. Duas leituras independentes podem iniciar e terminar concorrentemente; uma leitura lenta não bloqueia outra.
3. Um upload não bloqueia pedidos GET.
4. Alterações de organização permanecem ordenadas e não atravessam trabalho dependente do contexto da sessão.
5. Leituras de candidaturas não executam `pg_advisory_xact_lock`; comandos continuam a executá-lo.
6. Os contratos HTTP, a autoridade e o isolamento por organização são preservados.
7. `AbortSignal` chega à camada Axios e o cancelamento de um pedido obsoleto não atualiza estado nem apresenta erro ao utilizador.
8. Testes focados, testes de autoridade/isolamento afetados e build frontend passam sem novas falhas.

## Fora do âmbito

Dashboard agregado, matching, worker, controllers, alterações de schemas, novas dependências e otimizações de queries.

## Implementação e validação

- A fila global foi substituída por uma barreira concorrente para trabalho dependente do contexto implícito da sessão; apenas logout e seleção de organização são mudanças ordenadas.
- Pedidos com `X-C4G-Organization` explícito executam diretamente; uploads executam fora da barreira com timeout próprio.
- Leituras afetadas aceitam `AbortSignal`; listagem de candidaturas, parceiros e contagem por oportunidade cancelam pedidos obsoletos.
- O catálogo backend classifica explicitamente cada método com `access: 'read' | 'write'`; a composição só adquire o advisory lock organizacional para descritores `write` e recusa métodos desconhecidos. O lock não foi reduzido para candidatura porque o mesmo catálogo contém comandos sem candidatura e efeitos organizacionais.
- A adoção de cancelamento nesta fase está limitada à listagem de candidaturas, parceiros e contagem de candidaturas por oportunidade. Os wrappers dessas leituras propagam o `AbortSignal` até ao Axios; não existe ainda uma garantia de cancelamento global para todos os consumidores da API.
- Testes focados frontend de concorrência/cancelamento: 21/21 PASS. Suite frontend: 323/323 PASS. Build Vite: PASS, 1719 módulos.
- Testes de candidaturas/autoridade backend: 43/43 PASS. Suite backend: 1223/1226 PASS; as falhas atuais e fora do recorte são `f11RealTransportAdapters` (flaky reproduzida), `f12Composition` (fixture incompatível) e `f5AuthorityCommitGuard` (catálogo SQL incompleto). O ficheiro rastreado `dev/local/check.js` continua apagado no worktree e, por isso, a respetiva verificação F3 não entra atualmente na suite.
- Não existe script de lint ou type checking nos manifests atuais. `node --check` passou nos JavaScript alterados aplicáveis.
- Baseline PostgreSQL local, não SLO e sem comparação anterior: 10 leituras em cinco pares sobrepostos, p50 61,074 ms, p95 62,212 ms, espera de pool p50 0,078 ms/p95 0,258 ms, cinco queries por leitura, zero locks de candidatura em leituras e zero erros. A segunda escrita esperou 104,795 ms pelo lock mantido pela primeira.
- Não foi medido ganho de latência real. A API/OIDC não estava ativa e os gates integrados existentes criam bases, aplicam migrations ou alteram fixtures, operações excluídas desta revisão; portanto, p50/p95 HTTP, cancelamento pela stack completa e troca autenticada de organização permanecem por verificar.
- Veredicto da revisão: **REQUEST CHANGES** por verificação integrada em falta, mantendo a fase em **Review**. Relatório: [`../reviews/request-concurrency-phase-1.md`](../reviews/request-concurrency-phase-1.md).
