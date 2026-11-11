# S3 — composição central Portugal2030

30/10/2026. Código e SQL candidatos; nenhuma migração, importação real, rota ou worker ativado. [Contrato funcional](../../features/opportunity-data-standardization.md) e [provas S3](../../reviews/opportunity-data-standardization/s3.md).

## Portas e autoridade

`createCentralPortugal2030CandidateComposition({pool,documents,audit?,clock?})` liga transações e autoridade central existentes a `createCentralPortugal2030Import` e `createPlanCandidateArchive`. A construção é explícita e não lê flags para se autoativar. `pool` pertence à Central; o módulo não resolve tenants nem usa o workflow de importação privada. O `userId` do chamador interno tem de vir da sessão autenticada no servidor, nunca de um campo de identidade enviado pelo utilizador num futuro endpoint.

O workflow expõe `preview({userId,documentId,documentVersionId,sheetName,requestId?})` e `stage({userId,documentId,documentVersionId,sheetName,requestId,previewDigest})`. Valida objetos fechados, verifica a atribuição C4G atual antes de ler e volta a verificá-la com lock na transação de escrita. Falha de autoridade, documento ou auditoria não permite confirmar o arquivo.

A porta documental é obrigatória:

- `readVerifiedCentral(...)` devolve bytes e descriptor: `authority:CENTRAL`, `organizationId:null`, IDs imutáveis de documento/versão, nome, MIME, tamanho, SHA-256, `state:AVAILABLE`, `scanState:CLEAN`.
- O workflow copia os bytes, compara hash/tamanho/IDs e adapta o documento. Não aceita estados de scan ou snapshots no pedido.
- `assertCurrent(client,binding)` tem de lançar erro se documento/versão/hash/tamanho/estado limpo/acesso já não forem válidos. Tem de usar uma prova central autoritativa, não uma cache ou o valor recebido no primeiro passo, e proteger a validade até ao commit.
- A versão e os seus metadados têm de ser imutáveis. F11 deve manter política de ficheiros, quarentena, validação estrutural, antivírus, acesso ao original e reconciliação de armazenamento.

O F11 atualmente implementado é organizacional. **Não há adaptação concreta central de upload/antivírus/R2 nesta entrega.** A porta não pode ser implementada passando `organizationId:null` ao F11 tenant ou aceitando `clean:true` num pedido HTTP. As provas de workflow usam uma porta documental de teste; não são certificação do scanner.

## Três digests distintos

1. `sourceColumnsDigest`: hash normativo dos tipos/valores das13 colunas, independente da linha física. Mantido idêntico a S0.
2. `planPreviewDigest` e digest central: ligam bytes originais, folha, mapping, resultados, erros e células completas, incluindo `rawValue`/`styleIndex`. O digest central acrescenta documento/versão/MIME/tamanho. A observação posterior dos mesmos bytes não altera a intenção aprovada.
3. `payload_digest` do preview arquivado: liga o descriptor e o bundle integral, incluindo timestamps e metadados de proveniência. Verificado após leitura de JSONB, sem depender da ordem das chaves.

Os snapshots são rederivados das células no arquivo antes da escrita, e os previews guardados são revalidados. A leitura original, hash e parser ficam ligados pelo workflow confiável; um chamador HTTP futuro não pode fornecer bundles ou substituir o parser/portas.

## Persistência aditiva candidata

[SQL fora do manifesto executável](../../../backend/database/central/candidates/pt2030_plan_v2.up.sql):

| Tabela | Conteúdo |
| --- | --- |
| `pt2030_plan_preview` | Intenção por utilizador/request, descriptor e bundle completo, digests; imutável |
| `pt2030_plan_identity` | ID externo do plano e ponteiro operacional da última revisão candidata; independente de UUID de oportunidade publicada |
| `pt2030_plan_revision` | Snapshot v2 integral, digest factual, predecessor, número e comparação; imutável |
| `pt2030_plan_import` | Confirmação, referência ao preview e recibo reconciliado; imutável |
| `pt2030_plan_observation` | Uma linha por linha física, incluindo erros, células completas e referência à revisão candidata; imutável |

O arquivo não abre transações próprias. A transação parental conserva autoridade e documento verificados, candidatos, observações, recibo e auditoria até ao commit. Um advisory lock central serializa confirmações; cada avanço de revisão usa CAS. FK composta liga número, ID externo e revisão do ponteiro, impedindo numeração desacoplada. Pré-visualizações e confirmações têm request keys distintas, vinculadas ao utilizador.

Mesma intenção repetida devolve o recibo anterior após validar preview, bindings e contagens contra as observações; não repete auditoria ou criação. Outra observação com os mesmos factos cria observação, sem nova revisão. Alteração material gera `CANDIDATE_REVISION`; perda de factos ou conflito produz `REVIEW_REQUIRED`. A revisão anterior permanece íntegra. Nenhuma destas ações substitui uma revisão aceite/publicada; o ponteiro é apenas o último candidato da fonte. Linhas inválidas/IDs duplicados recebem `REJECTED`, sem identidade candidata e sem desaparecer das contagens.

Não há FKs para `funding_identity`, catálogo publicado ou dados privados. O descriptor documental usa referência opaca porque a persistência documental central ainda não existe; definir a FK/reconciliação real quando esse contrato for implementado. As tabelas novas têm owner central, revogação de acesso público/leitor de catálogo e permissões restritas à escrita central. Triggers preservam histórico e impedem TRUNCATE. Não foram alteradas permissões existentes.

## Limites e gates de ativação

Ficheiro10MiB; ZIP256 entradas e32MiB descomprimidos; XML8MiB por parte,150000 nós globais, profundidade64 e70000 células;5000 linhas; snapshot256KiB; bundle32MiB serializado/JSONB. Excesso provoca rejeição, não truncatura. SQL, integridade de papéis, atomicidade, concorrência real, dimensionamento de lotes, duração de locks e recuperação têm de ser testados em PostgreSQL isolado antes de ativação.

O envelope CENTRAL F9 atual admite apenas `funding_tenders.refresh`; não foi ampliado. Preparar job/allowlist/outbox próprios e bounded batching/retoma para o importador central, sem reutilizar envelopes tenant. Rotas futuras exigem sessão/autenticação recente e extração de identidade no servidor, sem expor bundles internos. Upload/antivírus, API/worker, esquema/fingerprints e HTTP/UI reais continuam sujeitos a gates separados; publicação de revisões e reconciliação/ativação pertencem a S5/S6.
