# F11 — Armazenamento privado de documentos e acesso temporário

- Tipo: `Feature`
- Estado: `Complete`
- Fecho: 2026-10-08
- Contrato normativo: `context/research/private-document-storage-decisions.md` (`F11-D1`–`F11-D33`)

## Resultado

Foi implementada a fundação local de armazenamento privado de documentos, sem R2 real, scanner real, filesystem, container S3, dados reais ou bases persistentes. A composição produtiva permanece fechada sem a validação futura da Camada C.

O resultado inclui:

- catálogo F5 `f11-document-permissions-v3` com os sete permission codes aprovados e zero grants nos quatro perfis;
- catálogo F7 `f11-events-v2` com os nove event codes aprovados, preservando os 25 anteriores;
- migration tenant `003_f11_private_document_storage`, com metadata tenant-local, estados fechados, RLS, optimistic locking, capabilities por digest e funções limitadas de transição/confirmação;
- `ObjectStoragePort` fechado e double obrigatório `f11-object-storage-double-v1`, apenas in-process e em memória;
- fronteira R2 fail-closed, sem SDK, signing, rede ou alegação de conformidade;
- keys opacas server-generated, capability one-shot de upload, upload streaming, limites, magic bytes, SHA-256 e multipart lógico;
- quarentena e `MalwareScanPort` com double local, mantendo OOXML em quarentena sem inspeção profunda real;
- versões imutáveis, confirmação idempotente, download abstrato autorizado e single-range limitado;
- jobs F9 infraestruturais fechados, eventos F7 sanitizados, reconciliação e métricas de baixa cardinalidade;
- composição produtiva sem double, scanner, handler ou fallback Legacy/filesystem.

## Catálogos

Permissions adicionadas, sem grants produtivos:

1. `document.upload.initiate`
2. `document.upload.confirm`
3. `document.read`
4. `document.version.create`
5. `document.version.list`
6. `document.download.request`
7. `document.quarantine.manage`

Eventos adicionados:

1. `DOCUMENT_UPLOAD_INTENT_ACCEPTED`
2. `DOCUMENT_UPLOAD_CONFIRMED`
3. `DOCUMENT_SCAN_COMPLETED`
4. `DOCUMENT_ACCESS_CAPABILITY_ISSUED`
5. `DOCUMENT_VERSION_CREATED`
6. `DOCUMENT_ACCESS_BLOCKED`
7. `DOCUMENT_RECONCILIATION_DETECTED`
8. `DOCUMENT_UPLOAD_CANCELLED`
9. `DOCUMENT_LIFECYCLE_REQUESTED`

## Critérios de aceitação

| Critério | Resultado | Evidência principal |
|---|---|---|
| DOC-AC-01 | Satisfied locally | adapter boundary exige buckets privados; composição permanece fechada |
| DOC-AC-02 | Satisfied | port fechado e inputs não aceitam bucket/key/endpoint/credentials |
| DOC-AC-03 | Satisfied | metadata tenant-local, contexto confiável e RLS |
| DOC-AC-04 | Satisfied | autorização F5 precede intent, upload e download |
| DOC-AC-05 | Satisfied | consultas e capabilities limitadas por organização; probes A/B |
| DOC-AC-06 | Satisfied | lookup por organização e resposta uniforme contra IDOR |
| DOC-AC-07 | Satisfied | IDs UUID opacos internos, sem filename ou PII |
| DOC-AC-08 | Satisfied | filename NFC sanitizado contra traversal/header injection |
| DOC-AC-09 | Satisfied locally | magic bytes e mismatch fail-closed; inspeção profunda fica em quarentena |
| DOC-AC-10 | Satisfied | limites por classe aplicados durante stream e multipart |
| DOC-AC-11 | Satisfied | tamanho, SHA-256, HEAD abstrato e confirmação verificados |
| DOC-AC-12 | Satisfied | estados/transições impedem disponibilidade prematura |
| DOC-AC-13 | Satisfied | confirmação idempotente e digest divergente reconciliado |
| DOC-AC-14 | Satisfied | versões/keys imutáveis e sem overwrite/deduplicação cross-tenant |
| DOC-AC-15 | Satisfied locally; Layer C pending | capability abstrata limitada; presigned R2 real não validado |
| DOC-AC-16 | Satisfied locally; Layer C pending | nenhum secret/URL real/log de capability; provider real pendente |
| DOC-AC-17 | Satisfied locally; Layer C pending | disposition seguro e políticas abstratas; HTTP R2 real pendente |
| DOC-AC-18 | Satisfied | apenas `AVAILABLE` + `CLEAN` permite download |
| DOC-AC-19 | Satisfied locally | scanner indisponível/OOXML não inspecionado falham fechados |
| DOC-AC-20 | Satisfied | taxonomia fechada de nove findings e reparação limitada |
| DOC-AC-21 | Satisfied | órfãos apenas detetados; sem eliminação automática |
| DOC-AC-22 | Satisfied locally | registry F9, idempotência, conditional create e fencing abstrato |
| DOC-AC-23 | Satisfied | nove eventos F7 e classes critical/deny/observational |
| DOC-AC-24 | Satisfied through F5 | revalidação bloqueia acesso sem apagar histórico |
| DOC-AC-25 | Satisfied | nenhum delete de documento confirmado ou lifecycle destrutivo |
| DOC-AC-26 | Satisfied | audit/métricas allowlisted, sem IDs em labels ou conteúdo |
| DOC-AC-27 | Satisfied locally; Layer C pending | double contratual; wire/SigV4/R2 não alegados |
| DOC-AC-28 | Satisfied | scan estrutural sem filesystem, Legacy, wildcard ou fallback |
| DOC-AC-29 | Satisfied locally | range, multipart, abort, caps e concorrência limitados |
| DOC-AC-30 | Satisfied | produção fail-closed; zero contacto com R2/dados/bases persistentes |

## Validação e revisão

- Testes F11 focados: `21/21` passaram.
- Suite backend: `424/424` passou.
- Regressões F5: `23/23`; F7: `16/16`; F9: `19/19`.
- PostgreSQL: 17.11 descartável, porta loopback `55411`, base sintética; migration F7→F11, rollback permitido, re-forward, restart, RLS e privilégios validados.
- Benchmark final do double: 200 iterações, 50 MiB, 127,08 ms, 393,46 MiB/s; não representa R2.
- `node --check`, `git diff --check` e scans finais passaram.
- Revisão adversarial final: `ready to close`, sem findings acionáveis.

Findings corrigidos no ciclo de revisão: trust boundary da capability; remoção de `UPDATE` direto do runtime; proteção de header no filename; quarentena de OOXML sem inspeção profunda; confirmação idempotente; extensão persistível do catálogo F7.

## Limitações preservadas

Continuam fora de F11: R2/S3 wire real, SDK/SigV4, presigned GET e CORS reais, semântica R2 de multipart/checksum/HEAD/range/metadata/erros, `jurisdiction=eu`, conta/termos/DPA, encryption/lifecycle/durability/limits, scanner real, retenção jurídica, legal hold operacional, eliminação física, F4.4/F4.5, dados reais, staging, produção e rollout.

O double não é equivalente ao R2 e nunca é fallback produtivo. A migration foi executada apenas no PostgreSQL descartável criado para F11; as bases locais persistentes em 5432/5433 não foram contactadas.
