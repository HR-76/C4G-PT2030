# Pesquisa — armazenamento privado de documentos e acesso temporário

Estado: recomendação consolidada, ainda não aprovada. Data: 2026-10-08.

## 1. Resultado executivo

Recomenda-se o identificador definitivo **F11 — Armazenamento privado de documentos e acesso temporário**. O inventário mostra F0–F10 reservados ou publicados; F7 pertence definitivamente à auditoria e F9 à execução assíncrona. Não existe uso de F11 no repositório, histórico Git, branches ou PRs referenciados.

A arquitetura recomendada usa um `ObjectStoragePort` C4G fechado, adapter Cloudflare R2 através da API S3-compatible e double/serviço S3-compatible descartável apenas nos testes. Upload é streamed através de uma capability C4G one-shot para a API, que impõe tamanho/checksum durante a transferência; download usa GET presigned de cinco minutos. Metadata é tenant-local, keys e buckets são internos, versões são imutáveis, scanning é assíncrono por port/F9 e nenhum objeto é legível antes de `AVAILABLE`.

R2 só pode ser usado realmente num bucket criado com **jurisdiction `eu`** e endpoint jurisdicional, sujeito a validação comercial/contratual da conta. Location hints `weur`/`eeur` são best effort e insuficientes. Sem entitlement, termos e preflight que comprovem a jurisdição, o rollout fica bloqueado; a implementação local por ports/doubles continua possível.

## 2. Factos, inferências e recomendações

- **Facto do projeto:** arquitetura e ADR escolhem R2 privado; metadata operacional pertence ao tenant; F5/F7/F9 são vinculativos; `SEC-AC-12/13` ainda não começaram.
- **Facto Legacy:** anexos UBI usam `multer.diskStorage`, validação por extensão, filesystem, metadata Legacy e remoção direta. Não há SDK S3/R2 instalado.
- **Facto externo:** R2 expõe API S3-compatible, mas não toda a superfície S3; capabilities devem ser verificadas operação a operação, não inferidas da compatibilidade geral ([matriz oficial R2](https://developers.cloudflare.com/r2/api/s3/api/)).
- **Inferência:** uma abstração limitada ao subconjunto usado reduz lock-in e impede que diferenças R2/S3 atravessem o domínio.
- **Recomendação:** todas as escolhas abaixo são normativas propostas, não decisões já aprovadas.

## 3. Inventário e identificador definitivo

| ID | Situação encontrada | Estado recomendado |
| --- | --- | --- |
| F0 | Mitigação dos riscos críticos Legacy, roadmap original | Reservado/publicado; não reutilizar |
| F1 | Fundação de testes, commit histórico | Concluído/publicado; não reutilizar |
| F2 | Identidade e sessão segura, histórico/PR | Concluído/publicado |
| F3 | Membership e contexto, histórico/PR | Concluído/publicado |
| F4 | Família tenancy; F4.0–F4.3 publicados; F4.4/F4.5 reservados | Ocupado/reservado |
| F5 | Autorização funcional, histórico/pesquisa/PR | Concluído/publicado |
| F6 | Auditoria no roadmap original | Reserva histórica obsoleta, mas não reutilizar sem reconciliação |
| F7 | Primeiro “R2 e documentos”; depois auditoria em pesquisa, branch, PR #18 e histórico | Definitivamente auditoria; referência antiga de documentos vira alias histórico |
| F8 | Privacidade e retenção no roadmap original | Reservado; não reutilizar |
| F9 | Jobs/worker no roadmap e execução assíncrona no histórico/pesquisa/PR #17 | Definitivamente execução assíncrona |
| F10 | Segredos e operação no roadmap original | Reservado; não reutilizar |
| F11 | Nenhuma ocorrência, branch, PR, decisão, pesquisa, feature ou histórico | Primeiro identificador verificado livre; atribuir a documentos |

Nome canónico: **F11 — Armazenamento privado de documentos e acesso temporário**.

Correções posteriores necessárias, fora desta pesquisa: trocar a identificação do contrato ativo; no roadmap preservar nota “F7 — R2 e documentos (identificador histórico substituído por F11; F7 pertence à auditoria)”; atualizar specs que tratem a antiga sequência como vigente; nunca renomear históricos/PRs/commits. Links antigos devem apontar para uma pequena nota/alias documental, não para cópia de contrato.

Prevenção de colisões: criar um registry único `context/feature-registry.md` com ID, nome canónico, estado, aliases e links; qualquer `load` valida unicidade contra registry, história Git, current-work, features, decisions e research. A atribuição de ID passa a ser decisão explícita e append-only.

## 4. Provider, port e capabilities

### Comparação

| Opção | Avaliação |
| --- | --- |
| R2 direto no domínio | Menos código inicial, mas acopla SDK, erros e lacunas S3; teste e mudança de provider difíceis. Rejeitada. |
| `ObjectStoragePort` + adapter R2/S3 | Mantém R2 aprovado, limita superfície, valida capabilities e permite doubles. Recomendada. |
| Adapter S3 genérico | Útil como mecanismo interno, mas “S3-compatible” não garante paridade. O adapter deve declarar perfil R2, não prometer S3 universal. |
| MinIO/S3-compatible local | Adequado apenas a testes de contrato; não prova R2, residência ou diferenças de API. |
| Filesystem | Apenas fixture unitária in-memory/temp explicitamente marcada; nunca adapter produtivo ou fallback. |

O port expõe: `putStream`, multipart interno (`begin/uploadPart/complete/abort`), `head`, `getDownloadCapability`, `getRange`, `deleteCandidate` (inativo até política), `listReconciliationPage`, health/capabilities e shutdown. Recebe IDs opacos, tamanho/checksum/MIME esperados e deadlines; devolve resultados C4G sanitizados. Bucket, endpoint, SDK command/output, ETag como integridade, credentials, URL crua persistível e mensagens externas não atravessam o port.

O adapter resolve bucket/jurisdiction/key, assina GET, faz streaming/multipart, mapeia erros allowlisted, impõe timeout/retry, recolhe metadata técnica e valida no startup: bucket privado, endpoint `eu`, CORS exato, inexistência de public development URL/custom public domain, encryption-at-rest declarada, ausência de lifecycle destrutivo e operações necessárias. Capability ausente ou resposta incompatível falha fechado.

R2 cifra automaticamente objetos e metadata com AES-256 e keys Cloudflare; SSE-C existe, mas CMK/SSE-C fica fora até existir gestão de chaves ([data security](https://developers.cloudflare.com/r2/reference/data-security/), [SSE-C](https://developers.cloudflare.com/r2/examples/ssec/)).

## 5. Residência e topologia

Location hints são apenas otimização best effort. Jurisdictional Restrictions garantem armazenamento e processamento na jurisdição; `eu` existe e usa endpoint `<account>.eu.r2.cloudflarestorage.com`. A jurisdição não pode ser alterada depois da criação ([R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)). DLS controla também processamento em custom domains e localização de logs/metadata, mas é add-on Enterprise e não substitui a jurisdição do bucket ([DLS](https://developers.cloudflare.com/data-localization/), [R2/DLS](https://developers.cloudflare.com/data-localization/how-to/r2/)).

Norma proposta: produção exige bucket `eu`, endpoint jurisdicional, termos/DPA e entitlement confirmados, scanner e logs com processamento/residência aprovados, metadata/backups PostgreSQL com política compatível e teste de preflight. `weur`/`eeur`, Automatic ou promessa comercial não documentada são insuficientes. Se qualquer garantia faltar, integração real e rollout ficam bloqueados; port/double local permanece autorizado.

Topologia: um bucket privado por **ambiente + jurisdição + classe**: `documents` e `quarantine` separados. Não criar bucket por organização: aumenta provisioning/policy/CORS sem benefício necessário ao isolamento lógico. Cada organização recebe namespace opaco derivado internamente, nunca nome/slug. Keys: `v1/<orgOpaque>/<documentOpaque>/<versionOpaque>/<objectOpaque>`, todos aleatórios UUIDv7/base32 sem PII; o caller nunca vê nem escolhe bucket/key. Quarentena usa key distinta e promoção é copy-to-new-key + confirmação, nunca overwrite. Offboarding preserva objetos; restore usa manifest metadata↔object e não reconstrói bindings por nomes.

## 6. Metadata e estados

Metadata autoritativa fica tenant-local:

- `documentId`, `organizationId`, `ownerResourceType/Id`, categoria opaca e estado lógico;
- `documentVersionId`, número, optimistic revision, uploader actor/membership, timestamps e correlation/causation;
- `storageObjectId`, bucket class interno, key opaca cifrada/ocultada ao caller, expected/observed size, declared/detected MIME, SHA-256, scan engine/version/result e provider revision mínima;
- intent/idempotency, upload expiry, multipart ID protegido, F9 execution, reconciliation state;
- referências futuras de retention policy/legal hold, nunca uma decisão jurídica inferida.

Não copiar título, filename, resource data, actor, tenant ou conteúdo para custom metadata do provider; no máximo IDs técnicos opacos e schema version.

Estados fechados de versão: `PENDING → UPLOADING → UPLOADED → SCANNING → AVAILABLE`; desvios: `PENDING|UPLOADING → CANCELLED|EXPIRED`, `UPLOADED|SCANNING → QUARANTINED|REJECTED|MISSING`, `AVAILABLE → SUPERSEDED|ARCHIVED|DELETE_PENDING`, e `DELETE_PENDING → DELETED` apenas numa feature jurídica futura. `QUARANTINED/REJECTED/MISSING` não retornam a `AVAILABLE` sem novo scan/reconciliação autorizada. Documento lógico referencia atomicamente uma versão `AVAILABLE`; versões são imutáveis.

## 7. Upload

### Escolha

Upload produtivo inicial é **proxy streamed pela API através de capability C4G one-shot**, não presigned PUT direto. A API autoriza F5, cria intent tenant-local, gera key interna e transmite stream ao adapter, calculando SHA-256, sniffing inicial e limite de bytes sem guardar em disco. Isto satisfaz enforcement durante upload.

R2 presigned suporta GET/HEAD/PUT/DELETE, não POST; URL pode ser reutilizada até expirar e é bearer. A documentação prova binding de `Content-Type`, mas não prova cap de bytes suficientemente forte para o contrato. Logo, presigned PUT/multipart direto fica experiência futura, não baseline ([presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)).

Fluxo: F5 → intent idempotente → capability C4G de 10 minutos, one-shot e vinculada a session/organization/resource/size/MIME → stream com cap → adapter PUT ou multipart → metadata `UPLOADED` → HEAD e checksum/tamanho → F9 scan → `AVAILABLE` apenas após clean + audit critical. Capability expirada/cancelada não inicia ou conclui. Confirmação externa não aceita key/ETag: usa intent ID e servidor consulta storage.

Defaults: máximo global 100 MiB; PDF 50 MiB; PNG/JPEG 20 MiB; DOCX/XLSX/PPTX 100 MiB. Multipart interno a partir de 16 MiB; partes uniformes de 8 MiB, máximo 16; último pode ser menor. R2 permite 5 MiB–5 GiB, 10 000 partes e até 5 TiB, mas esses limites não são os limites do produto ([uploads R2](https://developers.cloudflare.com/r2/objects/upload-objects/), [limits](https://developers.cloudflare.com/r2/platform/limits/)). Multipart incompleto é abortado pelo reconciler após 60 minutos; a regra provider default de sete dias é defesa adicional, não retenção documental.

## 8. Download e capability bearer

Cada pedido recarrega recurso/version, F3/F5, suspensão/offboarding, `AVAILABLE` e scan clean. O servidor emite GET presigned por cinco minutos, bucket/key/method fixos, `Response-Content-Disposition: attachment` com filename sanitizado e MIME detetado. Não persiste nem regista a URL; usa `Referrer-Policy: no-referrer`, CORS apenas para origins exatas da aplicação, sem cache partilhada (`private, no-store`) e audita emissão/acesso observável.

Single range é permitido, limitado ao tamanho do objeto; multi-range é recusado. A capability continua válida até expirar mesmo após revogação, suspensão ou offboarding: risco residual máximo de cinco minutos. Para documentos excecionalmente sensíveis, um futuro modo proxy pode oferecer revogação por request. Presigned só funciona no domínio S3 R2, não custom domain, e qualquer possuidor pode usá-lo até expirar ([presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)).

## 9. MIME, nomes e conteúdo

Allowlist v1: `.pdf`/`application/pdf`; `.png`/`image/png`; `.jpg|.jpeg`/`image/jpeg`; `.docx`; `.xlsx`; `.pptx` com os MIME OOXML oficiais. Proibidos: HTML, SVG, scripts, executáveis, atalhos, MIME genérico, `.doc/.xls/.ppt`, formatos macro-enabled, ZIP/RAR/7z e qualquer arquivo comprimido autónomo. OOXML é ZIP estruturado: parser limitado valida content types, paths, número de entradas, profundidade e expansão total ≤ 4× tamanho e ≤ 200 MiB; macros/embedded executables/external relationships falham fechado.

Extensão, MIME declarado e magic/container detection têm de concordar. PDF/imagem também passam por scanner e parser limitado; imagens são decoded com limites de dimensões/pixels no adapter futuro. Nome é NFC, máximo 180 UTF-8 bytes, sem controls/bidi invisível, CR/LF, separators, dot segments ou reserved names; usado apenas em metadata/content-disposition com fallback ASCII. Máximo local: 20 ficheiros por operação e 100 versões por documento; alteração futura exige feature funcional/sizing.

## 10. Checksum, scanning e quarentena

SHA-256 é calculado server-side durante stream e persistido. O adapter envia checksum suportado quando possível, mas o contrato sempre compara o digest C4G com leitura/HEAD verificável antes do scan. Em multipart, ETag não é checksum do objeto; R2 suporta SHA-256 composite, não full-object, portanto o digest lógico continua C4G ([compatibilidade/checksums R2](https://developers.cloudflare.com/r2/api/s3/api/); a semântica ETag multipart é também documentada pela [AWS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)). Download/restore/reconciliação amostral ou total recalcula SHA-256; mismatch põe `QUARANTINED` e falha fechado.

Scanning é assíncrono por `MalwareScanPort` + F9. F11 implementa contrato e double determinístico; não seleciona provider externo. ClamAV pode ser usado num teste descartável posterior, mas não é garantia produtiva nem fallback. Timeout 120 s por scan dentro do deadline F9 de 300 s; cinco tentativas F9 só para falha transitória. Scanner indisponível, signatures stale, timeout, erro, tipo incompatível ou poison deixam `SCANNING/QUARANTINED`, nunca `AVAILABLE`. Re-scan cria resultado versionado; false positive requer future `ManualReviewPort`, MFA/SoD e audit critical, sem bypass nesta fase.

## 11. Versionamento, retenção e reconciliação

Cada versão usa key nova; overwrite e deduplicação cross-document/cross-organization são proibidos. Conteúdo igual pode existir novamente; isto evita side channels e acoplamento de retenção. Concorrência usa optimistic revision no documento e idempotency key no intent; só compare-and-set muda `currentVersionId`. Rollback lógico escolhe uma versão anterior ainda `AVAILABLE` como nova referência auditada, sem alterar objeto.

Não existem deletes automáticos de documentos confirmados, lifecycle destrutivo, Object Lock alegado, legal hold operacional ou inferência jurídica. R2 lifecycle suporta delete/transição, mas fica proibido para objetos confirmados ([object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)). Única retenção técnica: intents sem bytes expiram em 10 min; upload/multipart incompleto é marcado `EXPIRED` e pode ser abortado após 60 min; objeto nunca confirmado torna-se órfão inventariado após 24 h, sem delete. Delete/archive/hold permanecem ports inativos futuros.

Jobs F9 sintéticos: expire-intent, abort-multipart, verify-upload, scan, reconcile-metadata-object e reconcile-capability. Detetam metadata sem objeto, objeto sem metadata, checksum/tamanho divergente, scan pendente, versão inconsistente, timeout e confirmação incerta. Só repetição de HEAD, requeue idempotente, abort de multipart comprovadamente incompleto e conclusão de estado já demonstrado são automáticos. Adoção, overwrite, delete, promoção de quarentena e mudança de versão exigem autoridade futura.

## 12. F5, F7 e métricas

Permission codes propostos, sem grants implícitos: `document.upload.initiate`, `document.upload.confirm`, `document.read`, `document.version.create`, `document.version.list`, `document.download.request`, `document.quarantine.manage`. O último é sensível, exige `RECENT_MFA`, SoD e autoridade futura; não fica executável produtivamente nesta fase. Não se criam operações de candidaturas.

Event codes F7 propostos: `DOCUMENT_UPLOAD_INTENT_ACCEPTED`, `DOCUMENT_UPLOAD_CONFIRMED`, `DOCUMENT_SCAN_COMPLETED`, `DOCUMENT_ACCESS_CAPABILITY_ISSUED`, `DOCUMENT_VERSION_CREATED`, `DOCUMENT_ACCESS_BLOCKED`, `DOCUMENT_RECONCILIATION_DETECTED`, `DOCUMENT_UPLOAD_CANCELLED`, `DOCUMENT_LIFECYCLE_REQUESTED`. Intent/access/version/lifecycle são critical-before-effect quando concedem capacidade ou alteram referência; bloqueio preserva deny; scan/reconciliation/cancel completion são observacionais reconciliáveis. Payload contém apenas IDs opacos, code/result, size bucket, MIME code, digest prefix não reversível e correlation/causation; nunca key, URL, filename ou conteúdo.

Métricas: operação, resultado, provider class, MIME class, size/latency bucket e retry bucket; nunca organization, tenant, actor, document, key, URL ou filename labels. Defaults locais: 4 streams globais/2 por organização; scan 4/1; 30 intents/minuto/organização e 120 globais; storage call 10 s, signing 2 s, HEAD 10 s; retry F9 aprovado (5 tentativas, full jitter base 2 s/cap 60 s); response metadata ≤ 64 KiB. Sizing/thresholds produtivos continuam gate.

## 13. Matriz integral das decisões pendentes

| ID | Pergunta e opções | Recomendação normativa | Evidência/impacto/risco/dependências |
| --- | --- | --- | --- |
| F11-D1 | ID: F7, renumerar, alias | F11; F7 audit permanece; alias histórico | Inventário F0–F10; exige registry/correções futuras |
| F11-D2 | R2 direto, port, S3 genérico | Port fechado + adapter R2/S3 | Isola lacunas S3; risco drift mitigado por capability preflight |
| F11-D3 | região/jurisdição | Somente R2 jurisdiction `eu` real | Hint não garante; conta/contrato são gate |
| F11-D4 | bucket por org/ambiente/classe | Ambiente+jurisdição+classe, documents/quarantine | Menos provisioning, blast radius separado; namespaces internos |
| F11-D5 | key UUID/hash/path | Key v1 com IDs opacos server-side | Evita PII/enumeração; sem dedup side channel |
| F11-D6 | metadata Central/tenant/híbrida | Tenant-local autoritativa | Co-localiza recurso/transação; F4.4 gate real |
| F11-D7 | binding antes/depois/caller | Binding imutável antes do upload | Impede IDOR e órfão sem dono |
| F11-D8 | proxy/presigned/worker | API streamed com capability one-shot | Enforcement de bytes/checksum; custo API é risco/sizing |
| F11-D9 | download proxy/presigned | GET presigned após F5 | Escalável; bearer risk limitado a 5 min |
| F11-D10 | TTL | Upload 10 min; download 5 min | Relógio controlado; sizing futuro |
| F11-D11 | limites | PDF 50, image 20, OOXML 100 MiB; 20/op, 100 versões | Defaults locais; requisitos funcionais podem reduzir |
| F11-D12 | MIME | Allowlist PDF/PNG/JPEG/OOXML sem macros | Minimiza superfície; detector/parser obrigatório |
| F11-D13 | checksum | SHA-256 C4G server-side | ETag não universal; reconcile/restore recalculam |
| F11-D14 | multipart | Interno ≥16 MiB, parts 8 MiB, max 16 | Compatível R2; não expor uploadId/key |
| F11-D15 | versioning | Versões de domínio imutáveis | Provider versioning não é SoT; CAS no current version |
| F11-D16 | overwrite/dedup | Ambos proibidos | Evita perda e leakage; maior custo aceitável |
| F11-D17 | scanner | `MalwareScanPort`, async F9, double local | Provider real gate; falha fecha acesso |
| F11-D18 | quarentena | Bucket/namespace separado e estado fechado | Nenhum GET capability antes de clean |
| F11-D19 | states | Máquina fechada da secção 6 | Impede promoção implícita; migrations futuras |
| F11-D20 | retenção | Conservadora; sem delete confirmado | Jurídico/hold bloqueiam destruição |
| F11-D21 | legal hold/delete | Ports futuros inativos | R2 não oferece Object Lock S3 equivalente aprovado |
| F11-D22 | órfãos | Inventariar, nunca apagar automaticamente | Autoridade/política futuras |
| F11-D23 | reconciliação | Jobs F9 incrementais e listagem bounded | At-least-once/idempotência; sem scan bucket ilimitado |
| F11-D24 | encryption | R2 managed baseline; CMK/SSE-C fora | Keys/secret manager/contrato pendentes |
| F11-D25 | logs/audit | F7 funcional + métricas fechadas | Provider logs complementares; DLS/log residence gate |
| F11-D26 | egress/rate | 4/2 streams, 30/min org, 120 global | Defaults locais; sizing produção futuro |
| F11-D27 | range | single-range bounded; multi-range deny | Reduz abuso; download continua bearer |
| F11-D28 | disposition | attachment default; inline não v1 | Evita conteúdo ativo e header injection |
| F11-D29 | CORS | Origins exatas, GET/HEAD mínimos | Upload é API; bucket nunca público/wildcard |
| F11-D30 | lifecycle/backup | Sem delete rule; manifests/restore sintético | RPO/RTO e backup real são gates |
| F11-D31 | testes | double + S3-compatible descartável | Não prova R2; capability conformance separado futuro |
| F11-D32 | fronteira | Fundação sintética, sem produto/UBI | Mantém independência F4.4/F4.5 |
| F11-D33 | storage descartável de integração | Apenas double contratual C4G v1; sem container S3 nesta fase | Nenhuma opção comparada fornece hoje endpoint S3 offline, gratuito, mantido e fixável com fidelidade suficiente; wire protocol fica no gate R2 real |

Cobertura: 33/33 decisões; F11-D1–F11-D32 permanecem inalteradas e F11-D33 fecha a tecnologia de teste sem declarar equivalência com R2. Nenhum comportamento local necessário fica em aberto. A conta, contrato e serviços reais são gates de integração, não decisões ocultas da implementação local.

## 14. Impacto nos 30 critérios

| Critério | Estado de determinação | Decisões/gates |
| --- | --- | --- |
| DOC-AC-01 | Completamente determinado | D2–D4/D29; R2 real requer preflight e conta aprovada |
| DOC-AC-02 | Completamente determinado | D2/D5; infraestrutura nunca vem do caller |
| DOC-AC-03 | Completamente determinado | D3/D6/D7; F3/F4 vinculativos |
| DOC-AC-04 | Completamente determinado | D7–D9; sete permissions F5 sem grants |
| DOC-AC-05 | Completamente determinado | D4–D7; matriz A/B sintética |
| DOC-AC-06 | Completamente determinado | D5/D7/D9; recurso recarregado antes do port |
| DOC-AC-07 | Completamente determinado | D5; key v1 opaca server-side |
| DOC-AC-08 | Completamente determinado | D12/D28; filename NFC e attachment seguro |
| DOC-AC-09 | Completamente determinado | D12/D17; allowlist, magic/container e scan |
| DOC-AC-10 | Completamente determinado | D8/D11/D14; proxy streamed aplica cap durante upload |
| DOC-AC-11 | Completamente determinado | D13; SHA-256 C4G antes de disponibilidade |
| DOC-AC-12 | Completamente determinado | D8/D14/D19/D23; estados, abort e reconciliação |
| DOC-AC-13 | Completamente determinado | D7/D13/D19; intent/digest idempotentes |
| DOC-AC-14 | Completamente determinado | D15/D16; nova key e CAS |
| DOC-AC-15 | Completamente determinado | D9/D10; GET presigned de cinco minutos |
| DOC-AC-16 | Completamente determinado | D2/D9/D25; sanitização e URL não persistida |
| DOC-AC-17 | Completamente determinado | D12/D27–D29; attachment e single-range |
| DOC-AC-18 | Completamente determinado | D18/D19; só `AVAILABLE` e clean é legível |
| DOC-AC-19 | Completamente determinado | D17–D19; scanner fail-closed; provider real é gate |
| DOC-AC-20 | Completamente determinado | D22/D23; scan incremental bounded |
| DOC-AC-21 | Completamente determinado | D20–D23; inventário sem delete automático |
| DOC-AC-22 | Completamente determinado | D17/D23 e contrato F9 |
| DOC-AC-23 | Completamente determinado | D25 e nove eventos F7 propostos |
| DOC-AC-24 | Completamente determinado | F3/F5; D20 preserva histórico |
| DOC-AC-25 | Completamente determinado | D20/D21/D30; destruição bloqueada |
| DOC-AC-26 | Completamente determinado | D25/D26; labels fechadas sem IDs |
| DOC-AC-27 | Completamente determinado | D2/D31; double + S3-compatible descartável |
| DOC-AC-28 | Completamente determinado | D2/D31/D32; filesystem apenas fixture |
| DOC-AC-29 | Completamente determinado | D10/D14/D27; limits/cancel/fencing |
| DOC-AC-30 | Completamente determinado | D3/D17/D30–D32; composição real fail-closed |

Resultado: **30 completamente determinados; 0 parcialmente determinados; 0 bloqueados para implementação local**. Integração R2 real, scanner real, tenants reais e operação continuam bloqueadas por gates externos e não podem ser alegadas pelos testes locais.

## 15. Plano de testes recomendado

- Unitários: state machine, key/name, capability, MIME/magic/container, size, SHA-256, TTL/range, CAS/versioning, sanitização, rate/concurrency.
- Contratos: port/adapter sem tipos SDK; forgery de bucket/key/endpoint; capability preflight; provider timeout/error; no filesystem fallback.
- Adversariais: A/B, IDOR, actor/context falsos, CRLF/traversal/Unicode, polyglot, macro/archive bomb, oversize, checksum mismatch, presigned reuse/expiry.
- S3-compatible descartável: private buckets, PUT/multipart/abort/HEAD/GET-range, concurrency, CORS, restart, objeto/metadata órfãos e restore sintético. Diferenças face ao R2 permanecem explicitamente não provadas.
- F9/F7: redelivery, crash em cada fronteira, confirmação incerta, scanner timeout/poison, audit critical indisponível, reconciliação determinística e dead-letter sanitizada.
- Revisão estrutural: zero SDK no domínio, public endpoint, wildcard, key/URL/PII em telemetria, lifecycle destrutivo, permission/grant implícito, route Legacy ou filesystem produtivo.

### 15.1 F11-D33 — Storage descartável de integração

Pesquisa verificada em 2026-10-08. Esta decisão substitui somente a expectativa de um container S3-compatible em F11-D31; não altera as decisões de domínio, o adapter R2 futuro nem F11-D1–F11-D32.

#### Comparação de opções viáveis

| Opção | Evidência oficial atual | Capabilities úteis | Limitações materiais | Veredicto |
| --- | --- | --- | --- | --- |
| MinIO Community em container | O repositório oficial foi arquivado em 2026-04-25, declara-se não mantido e a edição Community passou a source-only; o último release Legacy indicado é `RELEASE.2025-10-15T17-29-55Z`, AGPLv3, e a própria documentação manda construir a imagem ([repositório](https://github.com/minio/minio), [releases](https://github.com/minio/minio/releases)). | S3, multipart, presigned, HEAD/range/metadata e abort historicamente fortes. | Sem imagem Community oficial atual mantida/digest publicável; build próprio amplia supply chain; sem paridade R2; AGPL e manutenção encerrada. | Rejeitado. |
| LocalStack S3 em container | O repositório oficial Community foi arquivado em 2026-03-23; o projeto documenta Apache-2.0 mais EULA e comunicação opcional com servidores. A linha Community atual passou a exigir auth token/entitlement, contrariando execução offline sem credential real ([repositório](https://github.com/localstack/localstack), [EULA](https://github.com/localstack/localstack/blob/main/docs/end_user_license_agreement/README.md), [releases](https://github.com/localstack/localstack/releases)). | Emulação S3 ampla, Docker/Windows, presigned, multipart, HEAD/range/CORS. | Imagem gratuita offline mantida e fixável não ficou demonstrada; é emulador AWS, não R2; token/cloud contact conflitam com o gate. | Rejeitado. |
| Wrangler/Miniflare R2 local | Cloudflare mantém Wrangler `4.129.1` e Miniflare `5.20261006.0-alpha` (verificados em 2026-10-08); `wrangler dev` persiste R2 simulado localmente e não toca o bucket remoto ([local development](https://developers.cloudflare.com/workers/local-development/), [R2 Workers local](https://developers.cloudflare.com/r2/get-started/workers-api/), [Wrangler npm](https://www.npmjs.com/package/wrangler), [Miniflare npm](https://www.npmjs.com/package/miniflare)). | Binding Workers R2, metadata e multipart pela Workers API; manutenção ativa; MIT/Apache-2.0. | Não fornece endpoint S3-compatible/SigV4 para o adapter Node; não valida presigned GET, path/virtual-host style, CORS S3 ou erros wire. A própria referência distingue Workers API de S3 API ([Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)). | Rejeitado para F11; pode apoiar futura feature Worker, não este adapter. |
| Outro emulador ativo | Nenhum candidato com documentação oficial demonstrou simultaneamente manutenção, offline total, licença adequada, imagem imutável e matriz requerida com fidelidade R2. | Variável. | Introduzir candidato não provado seria nova decisão e falsa confiança. | Rejeitado. |
| Apenas double contratual | Implementação C4G in-process, sem dependência, rede, imagem ou filesystem; comportamento fechado controlado pelos testes. | Estados, stream/backpressure, SHA-256, multipart lógico, HEAD/range/metadata abstratos, timeouts/erros, idempotência, abort, F5/F7/F9 e reconciliação. | Não testa HTTP/SigV4, SDK, CORS real, presigned URL real, path style, códigos R2, limits ou divergências provider. | **Recomendado.** |

#### Decisão normativa

**F11-D33 — Apenas double contratual C4G v1.** Produto: double in-process próprio; edição: não aplicável; versão de contrato: `f11-object-storage-double-v1`; imagem/tag/digest Docker: não aplicável porque nenhum container é autorizado. A integridade equivalente é o ficheiro source versionado, o teste de forma do port e o hash do commit/lockfile no futuro plano de implementação; não se adiciona dependência npm.

Configuração fechada do double:

- armazenamento exclusivamente em memória por teste, sem persistência, filesystem ou rede;
- instância, buckets lógicos `documents`/`quarantine`, namespace, relógio e credentials-canário únicos por teste;
- nenhuma porta; se um harness HTTP estritamente necessário for criado, bind apenas a `127.0.0.1` numa porta efémera não 5432/5433, sem console/admin;
- healthcheck síncrono `ready/capabilities/version`, falhando para versão diferente de `f11-object-storage-double-v1`;
- cleanup por `dispose()` da instância exata, verificação de zero streams/timers/objects e nenhuma escrita no repositório;
- capabilities confiadas: contrato C4G de stream/backpressure/abort, size cap, SHA-256, metadata fechada, HEAD abstrato, single-range, multipart lógico/abort, conditional create, timeout/error injection e download capability opaca sintética;
- capabilities deliberadamente **não** confiadas: S3 wire protocol, SigV4/presigned, CORS browser, path-style/virtual-host style, ETag/checksum provider, R2 multipart/HEAD/range reais, HTTP error codes, jurisdiction, encryption, lifecycle, durability, concurrency/rate limits e object versioning.

Não há credentials reais: o double aceita apenas canários sintéticos e rejeita qualquer formato de endpoint/key/cloud credential. Nunca integra a composição produtiva nem funciona como fallback. Windows/Docker Desktop deixam de ser dependência do teste de storage; PostgreSQL 17 descartável continua separado para metadata.

#### Estratégia A/B/C aprovada proposta

- **Camada A — obrigatória agora:** double `f11-object-storage-double-v1` cobre domínio, autorização, estados, idempotência, failures, retries, scanning, reconciliação, streaming/backpressure e contratos do port.
- **Camada B — omitida conscientemente:** nenhum container S3-compatible é aprovado nesta fase. Os testes não podem ser rotulados como wire/S3/R2 integration.
- **Camada C — gate futuro R2 real:** ambiente descartável não produtivo, conta/DPA aprovados, `jurisdiction=eu`, endpoint jurisdicional e credentials efémeras devem validar SDK/SigV4, presigned GET, multipart/abort, SHA-256 suportado, HEAD, range, metadata, CORS, path/host style, limits e erros. Continua bloqueada e fora da implementação F11 local.

#### Impacto nos 30 critérios

| Critérios | Double A | Container B | Gate R2 C | Conclusão local |
| --- | --- | --- | --- | --- |
| AC-01–08 | Cobre fail-closed, forgery, contexto, F5, A/B, IDOR, key e filename | Omitido | Privacidade/policy/endpoint reais | Implementáveis localmente; configuração R2 é gate |
| AC-09–14 | Cobre MIME, size stream, SHA-256, incomplete/idempotency/versioning | Omitido | Checksum/multipart provider reais | Implementáveis localmente |
| AC-15–17 | Cobre capability abstrata, TTL, sanitização, disposition/range policy | Omitido | SigV4, URL, CORS e HTTP range reais | Parcial quanto ao provider; comportamento C4G implementável |
| AC-18–26 | Cobre quarentena, scanner, reconciliação, F9/F7, suspensão, retenção e métricas | Omitido | Operação/telemetria provider | Implementáveis localmente |
| AC-27 | Cobre contrato substituível, mas não adapter wire real | Omitido | Suite real do adapter R2 | Critério reformulado: adapter testável por port; conformance R2 é gate |
| AC-28–30 | Cobre ausência de fallback, limites lógicos e composição fechada | Omitido | Prova de zero public/misconfig real | Implementáveis localmente |

Os 30 critérios continuam implementáveis localmente no âmbito C4G. AC-15–17 e AC-27 ficam explicitamente **parciais quanto à semântica específica do provider** até à Camada C; isto não bloqueia código local, mas impede declarar integração R2 concluída.

#### Bloco adicional de aprovação

> Aprovo F11-D33: a tecnologia descartável da F11 será exclusivamente o double in-process C4G `f11-object-storage-double-v1`, sem container, imagem, dependência npm, filesystem, persistência ou rede; a integridade será a do source/testes versionados e commit/lockfile. O double é obrigatório e cobre o `ObjectStoragePort`, stream/backpressure/abort, limites, SHA-256, metadata, HEAD/range abstratos, multipart lógico, conditional create, timeouts/errors, idempotência, scanning, F5/F7/F9 e reconciliação. MinIO Community é rejeitado por estar arquivado/source-only sem imagem oficial atual mantida e digest seguro; LocalStack Community por arquivo/auth/EULA/offline não demonstrado; Wrangler/Miniflare porque simula Workers R2 e não o endpoint S3/SigV4. Não se declara equivalência com R2. S3 wire protocol, SDK/SigV4, presigned GET, CORS, multipart/checksum/HEAD/range/metadata e erros R2, jurisdiction `eu`, conta/DPA e limits permanecem Camada C futura bloqueada. Esta aprovação permite corrigir o identificador e promover F11 para `Ready`, mas não autoriza R2, credentials, dados reais, container S3, migrations persistentes, rollout ou deploy.

#### Texto exato para acrescentar a `current-work.md` após aprovação

```markdown
- **F11-D33 — Storage descartável de integração:** aprovado apenas o double in-process `f11-object-storage-double-v1`, em memória, sem rede/filesystem/container/dependência e nunca presente na composição produtiva. A Camada A valida domínio e `ObjectStoragePort`; a Camada B de container S3 é omitida por inexistir opção atualmente mantida, offline, gratuita e fixável com fidelidade suficiente; a Camada C R2 real continua gate futuro para SDK/SigV4, presigned, CORS, multipart/checksum, HEAD/range/metadata, errors, limits e `jurisdiction=eu`. Nenhuma equivalência com R2 é alegada.
```

```markdown
### Storage e testes em camadas

Implementar o double versionado `f11-object-storage-double-v1` com storage em memória isolado por teste, relógio/fault injection, streams rastreados e `dispose()` verificável. Não criar container S3. Executar unitários/contratos/adversariais na Camada A e PostgreSQL 17 descartável apenas para metadata; marcar AC-15–17 e AC-27 como parciais quanto ao provider. Manter a Camada C R2 real bloqueada até conta/DPA/jurisdiction UE e autorização separada.
```

## 16. Texto exato sugerido para `current-work.md` após aprovação

### Identificação

```markdown
- Tipo: `Feature`
- Estado: `Ready`
- Nome: F11 — Armazenamento privado de documentos e acesso temporário
- Identificador histórico substituído: “F7 — R2 e documentos”; F7 permanece definitivamente “Auditoria append-only e trilho de segurança”.
- Contrato aprovado: `context/research/private-document-storage-decisions.md`.
```

### Decisões aprovadas

```markdown
## Decisões confirmadas

F11-D1–F11-D32 estão aprovadas conjuntamente conforme `context/research/private-document-storage-decisions.md`: port fechado com adapter R2/S3; jurisdiction `eu` obrigatória para integração real; buckets privados por ambiente/jurisdição/classe com documents/quarantine; keys opacas; metadata tenant-local; upload API streamed one-shot; download GET presigned 5 min; upload 10 min; MIME/tamanhos/checksum/multipart fechados; scanning F9 por port; versões imutáveis sem overwrite/dedup; retenção conservadora; permissions/eventos versionados sem grants; reconciliação idempotente; métricas sanitizadas. Integração e rollout reais permanecem bloqueados.
```

### Arquitetura, defaults, limitações, plano e gate

```markdown
## Arquitetura e defaults aprovados

- `ObjectStoragePort` fechado; adapter R2 via S3-compatible; doubles/storage descartável local.
- Upload streamed pela API com capability one-shot de 10 min; download GET presigned de 5 min.
- PDF 50 MiB, imagens 20 MiB, OOXML 100 MiB; multipart interno desde 16 MiB, partes 8 MiB, máximo 16.
- SHA-256 server-side; scanning assíncrono fail-closed; estados e transições do contrato aprovado.
- Concorrência 4 global/2 por organização; scan 4/1; 30 intents/min/org e 120 globais; timeouts 2/10/120 s conforme contrato.

## Limitações e gates

R2 real exige jurisdiction `eu`, conta/termos/DPA, preflight e residência de scanner/logs/backups. F4.4/F4.5, migrations/bases persistentes, scanner real, retenção/hold/delete, CMK, backup/RPO/RTO, staging, produção e rollout ficam fora.

## Plano técnico

Planear catálogos F5/F7, metadata/state machine, ports/adapters, upload/download, SHA-256, MIME/parser, scanning, versioning, F9/reconciliation, métricas, migrations apenas descartáveis e testes 30/30. Não integrar R2 real nem Legacy.

## Gate de prontidão

Com aprovação humana conjunta de F11-D1–F11-D32, não resta decisão comportamental para implementação local. A feature pode ficar `Ready`; gates externos limitam integração e operação, não ports/doubles sintéticos.
```

## 17. Bloco único de aprovação humana

> Aprovo conjuntamente o identificador **F11 — Armazenamento privado de documentos e acesso temporário** e F11-D1–F11-D32: F7 permanece auditoria e F9 execução assíncrona; adota-se `ObjectStoragePort` fechado com adapter Cloudflare R2 pela API S3-compatible e storage descartável apenas em testes; integração real exige bucket privado com jurisdiction `eu`, endpoint jurisdicional, conta/termos/DPA e residência compatível de scanner, logs, metadata e backups, ficando bloqueada se essa garantia faltar; usam-se buckets por ambiente+jurisdição+classe, separados para documents/quarantine, namespaces e keys UUID opacas geradas pelo servidor; metadata é tenant-local e não replica dados funcionais para o provider; upload é streamed pela API mediante capability one-shot de 10 minutos, com F5, limite durante stream, MIME/content detection, SHA-256 e confirmação server-side; download exige F5/estado AVAILABLE/scan clean e usa GET presigned bearer por 5 minutos, attachment, no-referrer/no-store, CORS exato e single-range limitado; allowlist inicial é PDF até 50 MiB, PNG/JPEG até 20 MiB e DOCX/XLSX/PPTX sem macros até 100 MiB, com máximo 20 ficheiros por operação e 100 versões, bloqueando HTML/SVG, executáveis, formatos Legacy/macro e archives autónomos; multipart é interno desde 16 MiB, partes uniformes de 8 MiB e máximo 16; SHA-256 C4G é autoritativo e ETag nunca é checksum universal; scanning é assíncrono F9 via `MalwareScanPort`, fail-closed, com double local, timeout 120 s/deadline 300 s e sem provider real; versões usam keys novas, CAS, sem overwrite ou deduplicação; retenção é conservadora, sem delete/lifecycle destrutivo de documentos, legal hold/delete permanecem ports futuros e só intents expiram em 10 minutos, multipart incompleto é abortável após 60 minutos e órfãos são inventariados após 24 horas; F5 recebe os sete permission codes propostos sem grants e F7 os nove event codes propostos segundo as quatro classes; F9 trata scans/reconciliação com idempotência; defaults locais são 4/2 streams, scan 4/1, 30 intents/min/org e 120 globais, métricas sem IDs; testes cobrem 30/30 critérios com dados sintéticos, doubles e S3-compatible descartável, sem filesystem/Legacy fallback. Esta aprovação permite corrigir o identificador, promover F11 para `Ready` e elaborar o plano técnico, mas não autoriza R2/credentials/dados reais, migrations persistentes, scanner real, F4.4/F4.5, rollout ou deploy.

## 18. Fontes

### Internas

- `context/current-work.md`, `context/architecture.md`, `context/coding-standards.md`
- `context/features/security-privacy-and-audit-foundation.md`, `context/features/application-pipeline.md`
- `context/decisions/hosting-and-external-services.md`, `context/decisions/future-data-model.md`
- históricos F2–F5, F7 e F9; pesquisas F5/F7/F9; logical data dictionary
- código Legacy de `applicationRoutes.js`, `applicationController.js`, `migrations_v9.sql`; manifests e módulos F5/F7/F9
- Git history/PR references #4–#19 e roadmap original no commit `4b37014e...`

### Externas primárias

- [Cloudflare R2 — S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 — Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 — Data location and jurisdictions](https://developers.cloudflare.com/r2/reference/data-location/)
- [Cloudflare Data Localization Suite](https://developers.cloudflare.com/data-localization/)
- [Cloudflare DLS — R2](https://developers.cloudflare.com/data-localization/how-to/r2/)
- [Cloudflare R2 — Upload objects/multipart](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare R2 — Limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare R2 — Data security](https://developers.cloudflare.com/r2/reference/data-security/)
- [Cloudflare R2 — Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [AWS S3 — Object integrity and multipart ETags](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)
- [MinIO Community — repository, maintenance status and AGPLv3](https://github.com/minio/minio)
- [MinIO Community — official releases](https://github.com/minio/minio/releases)
- [LocalStack — official repository, Docker and licensing](https://github.com/localstack/localstack)
- [LocalStack Community EULA and network behavior](https://github.com/localstack/localstack/blob/main/docs/end_user_license_agreement/README.md)
- [Cloudflare Workers — local development with Miniflare](https://developers.cloudflare.com/workers/local-development/)
- [Cloudflare R2 — local Workers binding](https://developers.cloudflare.com/r2/get-started/workers-api/)
- [Cloudflare R2 — Workers API differences](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Wrangler `4.129.1` package record](https://www.npmjs.com/package/wrangler)
- [Miniflare `5.20261006.0-alpha` package record](https://www.npmjs.com/package/miniflare)

Next step: aprovar, rejeitar ou alterar conjuntamente o contrato antes de corrigir o identificador e promover a feature para `Ready`.
