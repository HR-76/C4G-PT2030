# S6 — persistência aceite em ensaio isolado

31/10/2026. Candidato aditivo fora do manifesto executável. O adapter não é importado pela composição habitual e não constitui ativação de recolha/publicação. Esta especificação complementa o desenho S1 e o relatório S6; a evidência da execução pertence ao gate isolado.

## Porta de aceitação

`createAcceptedOpportunityV2Repository({pool, authorize, verifyApproval, audit})` exige três portas do servidor, sem implementação permissiva por omissão. `authorize(client, context)` e `verifyApproval(client, binding)` têm de devolver `true`; `audit(client, event)` participa na mesma transação. A prova usa autoridade/aprovação sintéticas explícitas e uma tabela de auditoria de ensaio. Não demonstra OIDC, membership ou a implementação operacional de aprovação.

`preview(command, context)` devolve a reconciliação sem escrever. `accept({...command, approvalDigest}, context)` volta a derivar a mesma reconciliação sob locks e compara **`preview.previewDigest`**, não apenas o digest do conteúdo. O comando fechado contém:

- `requestId` e `candidateId`, opacos e limitados;
- `snapshot` v2 completo validado e `mappingDigest`;
- `expected: null` para uma identidade comprovadamente nova, ou `{opportunityId, revisionId, rowVersion}` para uma revisão existente;
- `approvalDigest` na aceitação, ligado à revisão/versão, bytes do candidato, mapping e metadados protegidos atuais.

A implementação operacional de `verifyApproval` terá de vincular a decisão autorizada ao candidato e arquivo de evidência previamente verificados. Um digest fornecido pelo cliente não é autorização. Não existe endpoint público que permita contornar esta porta. Sem configuração e validação dessas portas, o writer permanece indisponível na composição habitual.

## Transação e preservação

Locks por pedido e identidades funcionais são seguidos de lock/CAS da oportunidade. O writer resolve identidades v2 e identidades legadas Funding conhecidas; nunca reutiliza título como identidade. `PROGRAMME_METADATA` não é identidade de oportunidade. Não aplica aliases ou relações plano→aviso por inferência; essas decisões exigem integração editorial específica.

Uma proposta `BLOCKED` é recusada, incluindo a divergência documental POCTEP10, perda de factos, identidades incertas, correções e resoluções protegidas. As propostas admitidas exigem aprovação explícita da porta do servidor. Retry idêntico reproduz o recibo; a mesma chave com intenção diferente falha. Factos semanticamente iguais/mapping igual acrescentam observação e recibo sem uma revisão artificial. Mapping diferente exige nova aprovação e revisão.

Nova revisão, projeções, evidência, observações, vínculo da identidade, atualização do ponteiro, auditoria e recibo participam na mesma transação. Autoridade e aprovação são verificadas novamente antes do commit. Falha da auditoria ou revogação reverte tudo. UUIDs e revisões anteriores são preservados; o adapter não escreve bases tenant nem reescreve snapshots privados.

`opportunity.last_v2_observed_at` guarda o maior instante UTC das observações de snapshots aprovados e aceites. A mesma transação atualiza esta frescura também em UNCHANGED, sem incrementar revisão/rowVersion. Observações candidatas e `funding_identity.observed_at` legado não alimentam o campo; o relógio não recua com uma observação antiga. Os leitores compatíveis podem usar a coluna através de `to_jsonb(o)` e recorrer à proveniência do snapshot quando não existe metadado v2.

## SQL candidato

`backend/database/central/candidates/opportunity_persistence_v2.up.sql` acrescenta discriminantes e permite aliases nulos apenas com as versões v2. Os requisitos v1 permanecem condicionais e o snapshot histórico não é reescrito. Uma FK composta impede apontar à revisão de outra oportunidade; um constraint trigger diferido liga schema, números de revisão/rowVersion e digest ao ponteiro atual. Um escritor v1 não pode trocar silenciosamente o snapshot de uma oportunidade corrente v2.

Tabelas novas preservam identidades funcionais, observações, evidência por revisão, dotações, apoio/taxas/custos, conceitos, associações e prazos. As associações a programas/fundos não repetem o montante. Guards de inserção conferem cada projeção com o snapshot imutável da mesma revisão, incluindo evidência/observação e relações de dotação. Ausência é interpretada pelo Fact original; zero linhas não certifica ausência.

Dinheiro conserva texto canónico e `NUMERIC(32,8)`. A regex lexical rejeita precisão excessiva, notação exponencial, negativos e zeros finais não canónicos; uma conversão arredondada nunca sobrevive ao CHECK. Moeda ausente permanece null com estado. DATE, INSTANT e PERIOD têm colunas distintas. Helpers ISO representam o ano astronómico `0000` como 1 BC em PostgreSQL e preservam o texto original no JSON.

Todas as tabelas novas têm guardas append-only para UPDATE/DELETE/TRUNCATE, sem PUBLIC. O runtime central recebe apenas SELECT/INSERT; o leitor recebe projeções públicas e continua sem acesso às observações ou recibos de aceitação. O snapshot é validado integralmente no módulo S1 antes de qualquer transação; as constraints SQL são defesa adicional, não uma segunda implementação completa de JSON Schema.

## Provas reproduzíveis e limites

`test/integration/opportunity-v2/persistence-proof.cjs` recebe exclusivamente o pool descartável do gate S6. Aplica o candidato depois de semear uma revisão v1 sintética, admite os 191 candidatos não bloqueados do corpus de 192, verifica as 177 linhas PT2030 e recusa POCTEP10. Exercita ainda precisão extrema, ano ISO 0000, replay, concorrência/CAS, revogação, rollback, drift de projeções, restrições do leitor e imutabilidade. O gate principal regista a execução, fingerprints, contagens e limpeza do ambiente.

O âmbito é ensaio; não é um diff sobre os dados habituais. O rollout exige implementação/verificação das portas de aprovação e arquivo, autoridade real, manifesto/fingerprint aprovados, levantamento dos vínculos reais, preview renovado e ativação por fonte. Correções/resoluções históricas permanecem bloqueantes explícitos; não são removidas para facilitar a migração.
