# F10/F9 — Propagação de traces entre API, fila e worker

- Estado: `Proposed — human approval required`
- Data de verificação: 2026-10-08
- Âmbito: decisão técnica focada; não altera F9/F10, código, migrations ou operação externa.

## 1. Decisão em causa

Definir como transportar contexto W3C de tracing da API/produtor através do envelope fechado F9 até ao worker, preservando a compatibilidade explícita N/N-1, os digests, inbox/idempotência, retry, redelivery e replay. O contexto é exclusivamente operacional: nunca participa em autorização, organização, actor, permission, classificação, idempotência funcional ou efeito.

## 2. Factos vinculativos do repositório

- F9 usa envelope JSON canónico v1 fechado, até 32 KiB, entrega pelo menos uma vez e compatibilidade explícita N/N-1 sem upcast implícito.
- `backend/src/async/envelope.js` aceita exatamente as chaves v1, calcula SHA-256 sobre o envelope canónico completo e recusa qualquer campo adicional.
- A inbox identifica o efeito por `(consumer, jobType, jobVersion, organizationId, idempotencyKey)` e hoje compara `digest_sha256`; divergência fecha com `INBOX_DIGEST_CONFLICT`.
- Outbox armazena o envelope JSON e um digest; a mesma identidade lógica só é aceite com digest idêntico.
- Retry/redelivery conservam a mensagem lógica. Replay é autorizado, recebe novo `executionId` e conserva a mesma `idempotencyKey`; a inbox concluída torna-o no-op.
- `correlationId` e `causationId` são UUIDs funcionais/operacionais C4G, não W3C `trace-id`/`span-id`.
- F10 já possui parser local de `traceparent`, baggage proibido e correlation UUIDv7 interno, mas o envelope F9 v1 não possui trace context.
- Alterar silenciosamente as chaves v1 ou tratar v1 como v2 por upcast violaria o contrato publicado.

## 3. Evidência normativa externa

O OpenTelemetry recomenda anexar a cada mensagem um *message creation context* produzido pelo produtor; sem o transportar, o consumidor não consegue correlacionar diretamente os traces. Para uma única mensagem, o span `process` pode usar esse contexto como parent; quando existe outro contexto ambiente relevante, este deve ser preservado por link. Receção em batch usa links para os contextos das mensagens, evitando um parent único artificial. [OpenTelemetry Messaging Spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)

Propagação entre processos deve usar um `Propagator` com operações de extract/inject adequadas ao carrier. Links disponíveis na criação do span devem ser fornecidos nesse momento, porque podem participar na decisão de sampling. [OpenTelemetry Propagators API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/) e [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/)

W3C Trace Context define `traceparent` como contexto interoperável e `tracestate` como extensão opcional. Um `traceparent` inválido invalida o `tracestate`; `tracestate` admite no máximo 32 membros e os sistemas devem suportar pelo menos 512 caracteres. Os campos não podem transportar PII e precisam de limites contra abuso/DoS. Um serviço numa fronteira de confiança pode reiniciar o trace. [W3C Trace Context](https://www.w3.org/TR/trace-context/)

Na implementação JavaScript, extração/injeção usa `context`, `propagation` e `trace`; a instrumentação deve iniciar antes dos módulos instrumentados. [OpenTelemetry JavaScript propagation](https://opentelemetry.io/docs/languages/js/propagation/)

## 4. Alternativas viáveis

| Alternativa | Compatibilidade e segurança | Digests/idempotência | Semântica OTel | Avaliação |
| --- | --- | --- | --- | --- |
| 1. v2 com `traceparent`/`tracestate` no topo | Fecha schema, mas mistura campos de transporte com identidade funcional. | Obriga a redefinir digest; maior risco de uso acidental como autoridade. | Transporta contexto. | Viável, menos encapsulada. |
| 2. v2 com bloco `observability` não autoritativo | Evolução explícita; validação e limites ficam isolados; caller não o fornece. | Permite excluir o bloco do digest funcional e incluí-lo no digest integral. | Transporta creation context de forma explícita. | **Recomendada como base.** |
| 3. Sidecar técnico separado | Mantém envelope v1. Exige consistência, lifecycle e lookup adicionais. | Não toca no digest, mas cria órfãos e nova persistência. | Contexto pode faltar por race/retenção. | Rejeitada: complexidade e migration sem benefício. |
| 4. Apenas links reconstruídos por correlation/causation | Não altera F9. | Sem impacto. | UUIDs C4G não são `SpanContext`; não permitem link OTel válido nem ligação ao produtor. | Insuficiente. |
| 5. Contexto propagado + links | Usa a alternativa 2 e escolhe parent/link por semântica de entrega. | Mantém idempotência com digests separados. | Alinha mensagens imediatas, atraso, retry, replay e batch. | **Recomendação completa.** |

## 5. Contrato recomendado

### 5.1 Envelope v2

F9 evolui explicitamente para `envelopeVersion: 2`. A única diferença estrutural é a nova chave obrigatória `observability`, gerada internamente pelo produtor depois de criar/injetar o contexto OTel:

```json
{
  "observability": {
    "version": 1,
    "traceparent": "00-<32 hex>-<16 hex>-<2 hex>",
    "tracestate": null
  }
}
```

Regras fechadas:

- `observability` tem exatamente `version`, `traceparent` e `tracestate`; `version` é `1`.
- `traceparent` é string W3C version `00`, exatamente 55 ASCII bytes, com trace-id/span-id não zero e flags válidas. É `null` apenas quando não existe span gravável no produtor.
- `tracestate` é `null` ou string ASCII validada pelo propagator W3C, máximo 512 bytes, máximo 32 membros, sem entradas maiores que 128 caracteres. Na composição local F10 permanece normalmente `null`, pois não existe vendor/backend.
- Baggage não existe no schema, não é extraído nem propagado.
- O tamanho continua incluído no limite total de 32 KiB; o bloco tem limite próprio de 640 bytes.
- O caller e o payload não podem fornecer, substituir ou influenciar o bloco. O producer adapter recebe apenas o contexto OTel interno já validado; organização, actor, operation e sampling authority continuam nos contratos existentes.
- Na fronteira HTTP pública, um header válido pode ser extraído apenas como contexto remoto não autoritativo; a política C4G pode reiniciar o trace. Antes do enqueue, o produtor injeta o contexto interno resultante, nunca os headers brutos.
- Contexto ausente ou inválido não recusa o job: o produtor cria contexto local novo quando tracing está ativo, ou grava `traceparent:null,tracestate:null`. O header inválido é descartado e contabilizado por código fechado, sem conteúdo bruto.

### 5.2 Parent, links e attempts

- **Primeira entrega imediata de uma mensagem única:** o span `process` `CONSUMER` usa o creation context v2 como parent. “Imediata” significa `notBefore` ausente e primeira claim/attempt; não depende de um limiar temporal inventado.
- **Job atrasado (`notBefore`), retry ou redelivery:** cada attempt cria novo span `CONSUMER` root/local e inclui um link para o creation context original. Assim, uma mensagem antiga não mantém artificialmente um span pai aberto e cada tentativa continua observável.
- **Replay autorizado:** cria novo `executionId`, novo producer/creation context v2 e um link para o creation context anterior quando válido. Mantém correlation/causation e idempotency key segundo F9. O process span liga ao novo creation context; a inbox pode produzir no-op sem efeito.
- **Batch receive/claim:** o span de receção é root/local e contém um link por mensagem válida, limitado ao batch F9 de 10. Cada `process` segue a regra individual acima. Contexto inválido/ausente não elimina as restantes ligações.
- **Contexto ambiente no worker:** quando diferente do contexto da mensagem, é link adicional, não fonte de autoridade.
- Links são fornecidos na criação do span. Nenhum trace-id, span-id, correlation ou execution ID vira label métrica.

### 5.3 Digests e idempotência

F9 v2 passa a distinguir:

1. `contentDigest`: SHA-256 da projeção canónica funcional fechada — `jobType`, `jobVersion`, `payloadVersion`, `organizationId`, actor, operation, correlation/causation, idempotency key, deadline e payload. Exclui `envelopeVersion`, `executionId`, `createdAt` e todo o bloco `observability`.
2. `envelopeDigest`: SHA-256 do envelope v2 canónico completo, incluindo `observability`, `executionId` e timestamps.

Normas:

- Outbox/inbox e deteção de duplicação de efeito usam `contentDigest`; tracing nunca causa mismatch funcional.
- Queue/reconciliação podem usar `envelopeDigest` para integridade da publicação física concreta.
- A idempotency key, inbox key, classificação e efeitos não mudam.
- Retry/redelivery conservam ambos os digests e o creation context original.
- Replay conserva `contentDigest` e idempotency key, mas recebe novo `executionId`, creation context e `envelopeDigest`.
- Mesmo ID/chave com `contentDigest` diferente permanece fail-closed. Mesmo `contentDigest` com `envelopeDigest` diferente só é válido para replay explicitamente autorizado ou republicação reconciliada identificada; não é autorização para substituir payload.
- V1 continua a validar e usar o seu digest legado como `contentDigestV1`; não é recalculado como v2 nem convertido implicitamente. A compatibilidade é discriminada por versão.

## 6. Compatibilidade F9 N/N-1

| Producer | Envelope | Worker | Resultado |
| --- | --- | --- | --- |
| Antigo | v1 | Worker N (v2+v1) | Valida v1 pelo schema/digest legado; executa com novo span root sem parent/link OTel; correlation C4G permanece. |
| Antigo | v1 | Worker N-1 (v1) | Comportamento F9 atual. |
| Novo | v2 | Worker N (v2+v1) | Valida v2 e digests; aplica parent/link conforme attempt. |
| Novo | v2 | Worker N-1 (v1) | `INCOMPATIBLE`, sem handler/efeito; por isso o rollout futuro atualiza todos os workers antes de ativar producers v2. |
| Qualquer | desconhecido | Worker N | `INCOMPATIBLE` e dead-letter sanitizada; sem upcast. |
| Novo | v2 retry/redelivery | Worker N | Mesmo creation context, `contentDigest` e `envelopeDigest`; novo span attempt por link. |
| Novo | v2 replay autorizado | Worker N | Novo execution/context/envelopeDigest; mesmo contentDigest/idempotency; reautorização F5 e inbox mantêm no-op quando concluída. |

Não existe upcast v1→v2. Suporte N/N-1 significa que worker N possui validadores/handlers explícitos para v2 e v1; não significa que worker antigo aceite formato futuro.

## 7. Segurança e falhas

- Trace context é telemetria não autoritativa. Nunca decide autorização, membership, organização, actor, permission, scope, handler, retry, classificação ou efeito.
- O producer API descarta baggage e headers inválidos; nunca persiste headers brutos nem os regista.
- O worker revalida o bloco com o propagator oficial. Bloco ausente em v2, campo adicional, formato ou limite inválido gera sinal sanitizado e processa o efeito com trace local novo; não transforma falha de telemetria em falha funcional. Alteração estrutural/material do envelope continua `INCOMPATIBLE` quando compromete canonicalização/integridade.
- A distinção anterior exige validação em duas fases: schema funcional/digests permanece fail-closed; apenas falha semântica de trace context já isolado é degradável e removida antes de iniciar o span.
- Nenhum header, trace-id ou span-id aparece em logs, métricas, health, audit payload ou erro público. Os exporters in-memory podem conter SpanContext como parte do span local, não como label/atributo livre.
- Bounded context e batch máximo impedem amplification.

## 8. Impacto de implementação

### F9

- `backend/src/async/envelope.js`: adicionar validadores v1/v2 separados, schema `observability` v1, canonicalização por versão e funções `contentDigest`/`envelopeDigest`; preservar validador v1 sem upcast.
- `backend/src/async/outboxRepository.js`, `inboxRepository.js`, `outboxRelay.js`, `deadLetter.js` e reconciliation: usar o digest correto e transportar ambos apenas onde necessário.
- Producer/API e registry: criar v2 exclusivamente a partir do contexto interno; impedir bloco fornecido pelo caller.
- Worker/consumer: extrair contexto v2, escolher parent/link por attempt/delay/replay e degradar contexto inválido sem alterar o efeito.
- Replay: gerar novo creation context/envelopeDigest, conservar contentDigest/idempotency e link para contexto anterior.

### F10

- `backend/src/observability/propagation.js`: substituir parsing manual pelo propagator W3C oficial com carrier fechado e limites C4G.
- `backend/src/observability/context.js` e bootstrap: expor inject/extract internos, criação de producer/consumer spans e links allowlisted.
- Catálogos/logs/métricas: acrescentar apenas códigos/buckets fechados para `missing`, `invalid`, `v1`, `v2`, `parent`, `link`; nenhum ID.

### Testes e regressões

- Contract tests v1/v2, campo extra, limites, traceparent/tracestate válidos e adversariais, baggage ausente e caller forgery.
- Vetores canónicos provam contentDigest estável perante contexto/attempt/replay e envelopeDigest divergente quando a publicação muda.
- Inbox/outbox: mesmo conteúdo e trace diferente não duplica efeito; payload diferente conflita; v1 conserva digest legado.
- Matriz N/N-1 sem upcast; rollout worker-first; versão desconhecida/poison.
- Immediate parent; delayed/retry/redelivery/replay/batch links; contexto ausente/inválido cria trace local sem bloquear efeito.
- Regressões F5/F7/F9/F11 provam ausência de influência autorizativa e de IDs/headers em logs/métricas.

### Persistência

Não é necessária migration: `observability` vive no JSONB do envelope; as colunas de digest existentes podem continuar a guardar o digest funcional discriminado por versão e o envelope digest pode ser recalculado/transportado no adapter. Se a implementação concluir que ambos precisam de persistência consultável simultânea, isso deixa de ser esta decisão e exige migration separada e nova aprovação; não se deve sobrecarregar silenciosamente uma coluna.

## 9. Restantes findings F10

São lacunas de implementação já identificadas, não decisões arquiteturais desta pesquisa, e não são resolvidas aqui:

- iniciar o bootstrap OpenTelemetry antes dos módulos instrumentados;
- completar lifecycle/shutdown bounded da API e worker;
- adaptar integralmente sinais F5/F7/F9/F11 ao catálogo comum.

## 10. Bloco único de aprovação humana

> Aprovo a decisão F10/F9 de propagação de traces: F9 evolui explicitamente para envelope v2 com bloco fechado não autoritativo `observability` v1, contendo apenas `traceparent` W3C version 00 válido ou `null` e `tracestate` validado até 512 bytes/32 membros ou `null`; baggage permanece proibido, o bloco é criado apenas por adapters internos e nunca pelo caller, e contexto ausente ou inválido é descartado/substituído por contexto local sem alterar autorização, organização, actor, permission, idempotência funcional, classificação ou efeito. A primeira entrega imediata de mensagem única usa o creation context como parent; jobs atrasados, retries, redeliveries e batches usam spans locais com links ao creation context; replay autorizado cria novo executionId e novo creation context/envelopeDigest, liga ao contexto anterior e conserva correlation/causation, idempotency key e contentDigest. F9 v2 separa `contentDigest`, calculado sobre a projeção funcional fechada e excluindo envelopeVersion, executionId, createdAt e observability, de `envelopeDigest`, calculado sobre o envelope canónico completo; outbox/inbox e deduplicação de efeito usam contentDigest, enquanto integridade da publicação usa envelopeDigest. V1 mantém schema e digest legado sem upcast; worker N aceita explicitamente v2 e v1, worker N-1 aceita apenas v1, producers v2 só são ativados depois dos workers N, e versões desconhecidas são INCOMPATIBLE. Não há migration enquanto não for necessário persistir ambos os digests em colunas distintas. Aprovo os testes de canonicalização, digests, inbox/outbox, N/N-1, parent/links, retry/redelivery/replay/batch, forgery, limites e regressões F5/F7/F9/F11. Esta aprovação autoriza corrigir localmente F9/F10 e concluir os findings F10, mas não autoriza serviços externos, exporters de rede, OTLP, migrations persistentes, dados reais, rollout ou deploy.

## 11. Fontes

- [OpenTelemetry Semantic Conventions — Messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [OpenTelemetry Specification — Propagators API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)
- [OpenTelemetry Specification — Trace API and links](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OpenTelemetry JavaScript — Context propagation](https://opentelemetry.io/docs/languages/js/propagation/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
