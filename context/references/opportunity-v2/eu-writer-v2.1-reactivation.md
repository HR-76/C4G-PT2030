# Escritor EU — reativação após o mapeamento v2.1

Estado: **diagnóstico feito; passo 1 aplicado (descritor local); passos 2 a 5 por fazer.** Medido só em leitura a 11/11/2026 na Central local (`c4g_central_dev`) com `backend/scripts/localPlatform/euWriterStatus.js`. Este documento não autoriza executar a janela habitual; ver o [runbook do escritor](eu-writer-runbook.md) e o [mapeamento v2.1](../mapping-eu-v2.1.md).

## O que o mapeamento v2.1 mudou

O `mappingDigest` do escritor EU passou de `5419c2beb24e…` para `8dfe41aff93f…` (política `eu-existing-v2.0` igual). A admissão de jobs e a configuração/retoma autenticada exigem que o digest registado coincida com o publicado pelo código.

## Estado medido (Central local, 11/11/2026)

| Item | Valor |
| --- | --- |
| Migrações Central | 042 a 050 aplicadas (inclui 043, escritor EU) |
| Fonte EU | `QUIESCED`, fence 7, desde 31/10/2026 |
| Escritor registado na base | `CANONICAL_V2`, política `eu-existing-v2.0`, digest `5419c2be…` (**desatualizado**) |
| Descritor `opportunityEuWriter` em `.tmp/local-platform/runtime.json` | era `5419c2be…` (recusado no arranque como configuração inválida); **atualizado para `8dfe41af…` a 11/11/2026** (passo 1) |
| Digest publicado pelo código | `8dfe41af…` |
| Oportunidades EU no catálogo (`source_identity_v2`) | **0** |
| Runs de recolha / identidades v1 / proveniências | 0 / 0 / 0 |
| Pendentes de revisão (`MAPPING_IMPLEMENTATION_CHANGED`) | **0** |
| Catálogo | 178 oportunidades (corpus PT2030) |
| Histórico de controlo da fonte | SUSPEND, QUIESCE, CONFIGURE, RESUME, SUSPEND, QUIESCE (todos a 31/10) |

Conclusão: **não há oportunidades EU aceites a rever nesta base** e não há janelas preparadas dentro dela. A recolha EU foi reposta a zero na reposição do catálogo de 01/11/2026 e a fonte está suspensa. O que falta é só realinhar o escritor com o código; as consequências sobre dados aceites (revisão humana, planos e janelas antigas inválidos) só existem em ambientes com recolha EU já aceite, o que não é o caso aqui. O estado de qualquer outro ambiente (por exemplo produção) não foi medido.

## Passos para reativar (todos exigem pessoa autorizada)

1. ~~**Atualizar o descritor local**~~ **Feito a 11/11/2026.** `opportunityEuWriter.mappingDigest` em `runtime.json` passou para o valor publicado por `euWriterConfiguration()`; só essa chave mudou, com cópia prévia em `.tmp/local-platform/eu-writer-descriptor-backup-*` (permissões restritas). O validador de arranque (`euWriterRuntimeEnvironment`) aceita agora o descritor. A base continua com o digest antigo: o passo 2 é o que falta para o `euWriterStatus.js` passar a `WRITER_ALIGNED`.
2. **Reconfigurar o escritor na base**, com sessão administrativa atual, CSRF e autenticação recente: `POST /admin/opportunity-activation/sources/eu/writer` com `{requestId, expectedFence: 7}` enquanto a fonte está `QUIESCED` e sem runs pendentes (confirmado: 0). A API vincula a política e o digest publicados ao recibo e à auditoria; não aceita valores livres.
3. **Reiniciar API e worker** com a seleção explícita `OPPORTUNITY_EU_WRITER=canonical-v2` (e `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2`, `FUNDING_TENDERS_RUNTIME=central`, cobertura `durable-v1`, enriquecimento `verified-v1`) e verificar readiness, política e digest.
4. **Retomar a fonte** com `POST .../sources/eu/resume`, nova intenção e `expectedFence: 8`, e só depois pedir uma recolha controlada (limite de 5 resultados) pelo endpoint administrativo normal.
5. **Rever o resultado:** como não existe nenhuma identidade EU, todas as oportunidades recolhidas ficam em `REVIEW` e exigem aceitação humana pelo percurso existente (novo preview e aprovação). Verificar arquivo, contadores, fila de revisão e auditoria antes de ampliar.

Antes de 2, repetir `euWriterStatus.js` e uma cópia de segurança da Central, como nas outras janelas locais.

## Riscos e limites

- Passo 2 é um ato administrativo auditado na Central habitual; não foi executado e não pode ser feito sem uma sessão humana autenticada.
- A recolha real contacta a API pública da Comissão Europeia (sem credenciais) e cria dados na Central habitual: exige autorização expressa.
- Os 6 registos EuropeAid de formato antigo continuam fora do catálogo por conflito (item próprio do backlog).
- `euWriterStatus.js` só lê; devolve `WRITER_ALIGNED` ou `WRITER_RECONFIGURATION_REQUIRED`.
