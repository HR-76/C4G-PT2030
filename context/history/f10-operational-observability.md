# F10 — Observabilidade operacional, health e alertas

- Tipo: `Feature`
- Estado: `Complete`
- Conclusão local: 2026-10-08
- Contrato aprovado: [pesquisa F10](../research/f10-observability-decisions.md)
- Decisão complementar: [propagação F10/F9](../research/f10-f9-trace-propagation.md)

## Resultado

Foi implementada a fundação local comum de telemetria operacional para API e worker, sem backend externo, rede, OTLP, Collector, credentials, dados reais, rollout ou deploy. A auditoria F7 permanece separada e autoritativa.

Foram entregues:

- contratos e catálogos fechados v1 para logs, traces, métricas, health, alertas e runbooks;
- logging NDJSON com Pino, allowlist, redaction defensiva, limites e erros sanitizados;
- tracing e métricas OpenTelemetry com exporters exclusivamente in-memory;
- contexto operacional isolado, correlation UUIDv7 e W3C Trace Context sem baggage;
- envelope F9 v2 compatível, com bloco `observability` não autoritativo;
- `contentDigest` funcional separado de `envelopeDigest`, ambos recalculados nas fronteiras;
- spans reais no relay e worker com parent na primeira entrega e links em atraso, retry, redelivery, replay e batch;
- métricas comuns não autoritativas nos caminhos F5, F7, F9 e F11;
- health público sanitizado, estados `READY`, `DEGRADED` e `UNAVAILABLE` e registry interno;
- lifecycle limitado de API e worker, handlers explícitos, draining, flush e shutdown idempotente;
- alert catalog local e dez runbooks versionados;
- remoção de `console.*` dos caminhos produtivos abrangidos.

## Dependências fixadas

- `pino@10.4.0`
- `@opentelemetry/api@1.9.1`
- `@opentelemetry/sdk-node@0.223.0`
- `@opentelemetry/sdk-trace-node@2.12.0`
- `@opentelemetry/sdk-metrics@2.12.0`
- `@opentelemetry/instrumentation-http@0.223.0`
- `@opentelemetry/instrumentation-express@0.71.0`

Não foram adicionados OpenTelemetry Logs SDK, exporters OTLP, transports Pino ou dependências de rede.

## Decisão F9 v2

O envelope v1 permanece inalterado. O worker atual aceita explicitamente v1 e v2; versões desconhecidas são `INCOMPATIBLE` e não há upcast implícito. V2 admite apenas `observability.version`, `traceparent` e `tracestate`, criados por adapter interno. Baggage e controlo pelo caller são proibidos.

O digest funcional exclui contexto de observabilidade e identidade/tempo de execução. Outbox e inbox recalculam o digest a partir do envelope validado; a publicação valida o digest do envelope completo. Replay preserva identidade funcional, correlation, causation e idempotency key, mas cria novo execution/contexto e novo envelope digest.

## Findings formais corrigidos

1. **Spans reais F9:** relay e worker executam spans OpenTelemetry reais; testes inspecionam o exporter in-memory, parent e links bounded.
2. **Digests autoritativos:** outbox, inbox, queue adapter, dead-letter e replay validam o envelope e recalculam os digests; valores fornecidos são apenas comparados em tempo constante.
3. **Sinais reais F5/F7/F9/F11:** os adapters comuns foram ligados aos serviços/repositories reais sem alterar efeitos funcionais.
4. **Lifecycle do worker:** handlers de processo são explícitos, removíveis e idempotentes; draining, cleanup, flush e shutdown têm limites.
5. **Exporters reais:** o provider/exporter in-memory real é exercitado; wrappers do lifecycle real cobrem sucesso, rejeição, hang, conclusão/rejeição tardia e chamadas repetidas sem `unhandledRejection`.

## Revisão F10-AC-01–F10-AC-28

| Critério | Resultado | Evidência principal |
|---|---|---|
| F10-AC-01 | Satisfied | `logger.js`, schema v1 e NDJSON testado. |
| F10-AC-02 | Satisfied | Campos reservados e signal codes fechados. |
| F10-AC-03 | Satisfied | Sanitização e corpus adversarial sem secrets/PII. |
| F10-AC-04 | Satisfied | Allowlist de PII produtiva vazia. |
| F10-AC-05 | Satisfied | Erros externos reduzidos a códigos internos. |
| F10-AC-06 | Satisfied | Correlation/causation e envelope F9 v2. |
| F10-AC-07 | Satisfied | W3C validado, baggage recusado, contexto sem autoridade. |
| F10-AC-08 | Satisfied | Labels recusam IDs e valores livres. |
| F10-AC-09 | Satisfied | Budgets 128/4096 e overflow contabilizado. |
| F10-AC-10 | Satisfied | Catálogo v1 valida nomes, unidades e buckets. |
| F10-AC-11 | Satisfied | Contrato comum em API e worker. |
| F10-AC-12 | Satisfied | Liveness local sem dependências. |
| F10-AC-13 | Satisfied | Readiness por dependência/criticalidade. |
| F10-AC-14 | Satisfied | Payload público mínimo e sanitizado. |
| F10-AC-15 | Satisfied | READY/DEGRADED/UNAVAILABLE testados. |
| F10-AC-16 | Satisfied | Bootstrap e configuração inválidos falham antes do serviço. |
| F10-AC-17 | Satisfied | Draining, flush 5 s e shutdown 30 s bounded. |
| F10-AC-18 | Satisfied | Falhas/drop do exporter não alteram efeitos. |
| F10-AC-19 | Satisfied | Telemetria não substitui nem duplica F7. |
| F10-AC-20 | Satisfied | Sinais F9 fechados em caminhos reais. |
| F10-AC-21 | Satisfied | Sinais F11 fechados em caminhos reais. |
| F10-AC-22 | Satisfied | Agregados/budgets sem identidade de tenant. |
| F10-AC-23 | Satisfied | Dez alertas com runbooks locais válidos. |
| F10-AC-24 | Satisfied | Benchmark declara baseline local, não SLO. |
| F10-AC-25 | Satisfied | Probes adversariais e ausência de handles/rejections residuais. |
| F10-AC-26 | Satisfied | Exporter de rede/configuração proibida falha fechado. |
| F10-AC-27 | Satisfied | Suite local sem rede, DB ou serviços externos. |
| F10-AC-28 | Satisfied | Scan estrutural sem `console.*` produtivo ou fallback inseguro. |

Veredicto formal: `ready to close`; 28/28 `Satisfied`, zero findings acionáveis.

## Validação final

- Testes focados F10: 26/26.
- Regressões focadas F5/F7/F9/F11: 80/80.
- Suite backend completa: 451/451; zero falhas, skips ou TODO.
- `node --check`: 51 ficheiros JavaScript alterados/novos.
- `git diff --check`: aprovado.
- Benchmark local, 10 000 operações: logger 31,94 ms; métricas 8,74 ms; contexto 22,31 ms; uma série. Resultado é baseline local, não SLO nem sizing produtivo.
- Scans: sem exporters de rede, OTLP, OpenTelemetry Logs SDK, `console.*` produtivo ou testes ignorados.
- Nenhuma migration criada ou executada; PostgreSQL em 5432/5433 e serviços externos não foram contactados.

## Limitações e gates futuros

Continuam fora desta feature:

- OTLP, exporters/backend reais, Collector e SIEM;
- credentials e retenção produtiva de telemetria;
- sampling e sizing produtivos;
- thresholds de taxa/latência, SLI/SLO e dashboards finais;
- ownership operacional, paging e on-call;
- validação em staging/produção, rollout e deploy;
- F4.4 e F4.5.

As vulnerabilidades npm preexistentes não foram alteradas nem atribuídas às dependências F10 sem evidência.
