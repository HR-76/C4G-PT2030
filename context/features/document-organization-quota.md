# Limites de ficheiro e quota documental por organização

Estado: Fase 1 em uso no código; fase 2 (eliminar documento) implementada, migração 039 registada e provada em PostgreSQL descartável, mas não aplicada a nenhuma base habitual.

## Decisão de produto (11/11/2026)

Motivo: controlar o custo de armazenamento no R2. O escalão gratuito observado é de 10 GB; com quota de 2,5 GiB, quatro organizações cabem nesse escalão. Valores a confirmar no painel Cloudflare antes de produção; podem ser alterados por configuração em `backend/src/documents/constants.js`.

| Limite | Valor |
|---|---|
| PDF | 20 MiB |
| Imagem (PNG/JPEG) | 10 MiB |
| DOCX/XLSX/PPTX | 25 MiB |
| Quota por organização | 2,5 GiB (2 684 354 560 bytes) |

Os valores substituem os anteriores (50/20/100 MiB). Os limites das importações (10 MiB, 5 000 linhas) e dos PDFs de faturação (10 MiB) não mudam. A quota de 10 GiB do contrato inicial foi substituída por esta decisão.

## Critérios de aceitação

### Fase 1 — implementada

- Cada intenção nova reserva o tamanho declarado, incluindo uploads ainda não concluídos. Um replay idempotente não cria nova reserva (a intenção existente é detetada antes da reserva).
- A admissão e a reserva são atómicas: `pg_advisory_xact_lock` por organização na mesma transação do `INSERT`, na base tenant. Sem migração.
- Contam para a quota todos os estados exceto `CANCELLED`, `EXPIRED` e `DELETED`: versões antigas (`SUPERSEDED`/`ARCHIVED`), quarentena e rejeitados continuam a contar, porque o armazenamento físico não está comprovadamente libertado.
- Pedido acima do limite é recusado com HTTP 409 `DOCUMENT_QUOTA_EXCEEDED` e mensagem compreensível na interface; nenhuma reserva parcial. Exatamente no limite é aceite.
- Autorização, isolamento por organização e limites por ficheiro mantêm-se; o cliente mostra os novos limites.
- Testes: `backend/test/documentOrganizationQuota.test.js` (limite exato, excesso, serialização, estados contados, isolamento) e `f11PrivateDocumentStorage.test.js` (limites).

### Fase 2 — eliminar documento (código implementado; ativação pendente)

Decisão do utilizador (11/11/2026): o cliente elimina, depois de descarregar se quiser; não há eliminação automática. Como hoje cada upload cria um documento novo e nenhuma versão fica "antiga" (nada define `current_version_id` nem `SUPERSEDED`), o modelo escolhido é **eliminar documento**, não versões antigas. Perfis: quem já pode carregar versões (`DOCUMENT_VERSION_CREATE`). Sem limite de versões; só a quota.

- Elimina documentos em `AVAILABLE`, `QUARANTINED` ou `REJECTED`, na interface, a partir da lista de documentos por associar ("Eliminar documento", com confirmação de irreversibilidade).
- Fluxo: `DELETE_PENDING` (reserva) → guarda de candidatura → auditoria crítica (`DOCUMENT_LIFECYCLE_REQUESTED`) → remoção no R2 (`deleteObject`, ausência conta como removido) → `DELETED`. Só `DELETED` liberta quota. Falha do R2 deixa `DELETE_PENDING` (continua a contar) e o mesmo pedido retoma; falha da guarda ou da auditoria reverte a reserva sem tocar no R2.
- Protegido (409 `STATE_CONFLICT`): documento com associação ativa a uma candidatura, com pedido de revisão, ou associado a candidatura já submetida, aprovada, rejeitada ou arquivada. Para eliminar, retirar primeiro a associação, desde que a candidatura não esteja submetida.
- HTTP: `DELETE /api/applications/:id/documents/:documentId/versions/:versionId`.
- Código: `deletionService.js`, `applicationTransport.deleteDocument`, guarda `documentDeletionGuard` em `applications/documentsReview.js`, `deleteObject` no contrato `ObjectStoragePort` e no adaptador R2, métodos `beginDeletion`/`cancelDeletion`/`finishDeletion` no repositório.
- **Migração registada (11/11/2026):** `backend/database/tenant/migrations/039_document_deletion.up.sql`, ordinal 39, no manifesto (`documentDeletionManifest`, capacidade `DOCUMENT_DELETION`, checksum e `schemaFingerprint` reais). É **irreversível, sem script `down`**, como as migrações 033–038: repor o `CHECK` removido seria impossível depois de existirem linhas `DELETED`. Reconhece-se em `tenantMigrationRunner` (`createDocumentDeletionMigrationRunner`), `tenantMigrationPreflight`, `tenantResolver`, `opportunities/preflight` e no verificador do perfil local.
- **Não é exigida pelo runtime:** o requisito mínimo continua a ser a 038 (`createApplicationTaskDetailsMigrationRunner`, `composition.js`). Uma base em 038 continua válida, sem a eliminação; uma base em 039 também é aceite. A migração **não foi aplicada a nenhuma base habitual**; aplicá-la à base local (`c4g_tenant_dev`) ou a produção é um passo à parte, com autorização própria. Sem ela, a rota de eliminação falha com erro de serviço.
- **Validação em PostgreSQL 17 descartável (11/11/2026):** contentor próprio, só em `127.0.0.1`, removido no fim; sem bases habituais, R2 ou fornecedores. `test/integration/document-deletion/proof.js`: 23 verificações PASS. A migração é aplicada pelo runner oficial (fingerprint e ledger conferem; repetir é no-op); funções `SECURITY DEFINER` de `c4g_document_owner`; reserva, cancelamento e conclusão; recusa de aplicação dona errada e de estados não elimináveis; isolamento por organização; o runtime não faz `UPDATE` direto e outros papéis não executam; `DELETED` deixa de contar na quota; guarda SQL (ligação ativa, aplicação arquivada, documento livre) contra tabelas reais.
- **Defeito encontrado e corrigido pela prova:** a migração 003 tem `CHECK(state<>'DELETED')` (`document_version_state_check`); a 039 remove-o.
- **Por validar:** a guarda executada pelo runtime de candidaturas (RLS e permissões reais; a prova usou superutilizador com FKs desligadas para linhas sintéticas), o R2 real, o fluxo HTTP completo contra a base migrada e a reconciliação automática de linhas `DELETE_PENDING` (hoje só o retry manual as retoma). `test/integration/partner-portal/sources.json` (inventário de ficheiros preparado) não foi regenerado.
- Testes: `documentDeletionService.test.js`, `documentDeletionTransport.test.js` e `documentDeletionMigrationRegistration.test.js` (ordem, rollback, retry, idempotência, protegido, contrato de storage, R2 com cliente simulado).

## Evidência e limites

Valida-se apenas com testes unitários (cliente SQL simulado). A serialização real por `pg_advisory_xact_lock` e a contagem sobre dados existentes exigem PostgreSQL descartável explicitamente autorizado, ainda não executado. O estado efetivo do R2 não foi consultado; o runbook de 02/11/2026 regista ausência de conta Cloudflare nessa data. O contador é conservador relativamente a objetos órfãos; reconciliação com o fornecedor continua necessária para provar o consumo físico. O limite reduz o tamanho de novos uploads; documentos já guardados acima dos novos limites não são alterados.
