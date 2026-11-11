# Escritor automático EU compatível com v2

Contrato aprovado — 31/10/2026. Estado da execução e resultados no [relatório](../../reviews/opportunity-data-standardization/eu-writer.md). Incremento da normalização das oportunidades; implementação atual Central/worker, sem alterar a arquitetura multi-instituição aprovada.

## Âmbito e decisão confirmada

Pedido: integrar e ensaiar o escritor EU v2 antes da retoma controlada. O utilizador confirmou: **atualizar automaticamente oportunidades já em v2 quando não há perdas ou conflitos; enviar novos IDs e migrações v1 para revisão**. A mesma política abrange as seleções EU Funding & Tenders, CORDIS e Erasmus que usam a identidade EU. Interreg/POCTEP preservam o percurso existente.

Integração opt-in e ensaio PostgreSQL/worker exclusivamente descartável. O ambiente habitual permanece Central042/tenant034, EU QUIESCED/fence3, chamada11145 na revisão5. Este incremento não instala043, não muda configurações habituais e não retoma a recolha habitual. Os ficheiros SQL036–042, pacote11145, normativos S0/Excel e provas anteriores são imutáveis.

## Contrato funcional

1. O transporte conserva a descoberta P3: IDs descobertos não criam identidades; apenas lookup completo, evidência oficial e candidato rederivado permitem avaliação. O arquivo canónico é obrigatório no percurso EU v2; nenhum fallback para escrita v1.
2. Identidade v2 existente, mapping igual, CAS atual e ausência de perdas/conflitos/estado protegido permitem aceitar UNCHANGED ou alteração factual segura. UNCHANGED conserva revisão e rowVersion; observação aceite pode avançar frescura. Alteração segura cria uma revisão v2 e projeções normalizadas.
3. NEW, migração v1, mapping diferente, conflito, perda, identidade ambígua e correções/resoluções protegidas conservam o catálogo e produzem decisão durável de revisão, com razões e vínculo ao arquivo. Nunca se fabrica uma aprovação humana. A revisão não conta como oportunidade criada/atualizada.
4. Autoridade SERVICE FUNDING_TENDERS_CENTRAL vinculada ao pedido administrativo persistido, execução/inbox, lease, fences do run e fonte, política e arquivo atuais. Revalidação antes do commit; revogação, expiração ou mudança de época impedem efeitos. Sessão humana continua obrigatória no percurso humano existente.
5. Catálogo, projeções, observações, recibo, auditoria SERVICE, resultado do item e contadores são atómicos na transação do worker. Replay não duplica efeitos; divergência de intenção é recusada. Rede fora da transação.
6. SQL043 aditivo distingue modo legado e canónico e recusa escritores v1 em EU canónico, mesmo com fonte ACTIVE. A possibilidade futura de retoma v2 depende de configuração explícita, capacidade compatível e fonte/época atuais. O controlo humano de suspensão/quiescência mantém-se.
7. Modo/política/mapping ficam fixados no run e sucessores. Reinício não converte runs legados nem permite envelopes antigos adquirir autoridade v2. Capacidade publicada no heartbeat e verificada pela admissão.

## Critérios de aceitação e ensaio

- Testes direcionados: política de aceitação/revisão, P3, ausência/corrupção do arquivo, downgrade, proteção de correções, identidade/CAS, replay, authority/leases/fences e rollback.
- SQL isolado real: instalação042→043 com pacote separado e fingerprints medidos; admissão042 preservada; ciclo pelo worker/queue/arquivo/persistência e auditoria; 11145 mantém120000, moeda NOT_FOUND e sete prazos; leitores v1/v2 concordam.
- Casos de alteração segura e UNCHANGED; NEW/v1/perdas/conflitos em revisão sem alterar head; falha antes de commit sem efeitos parciais; replay; pausa/lease obsoleta; SQL/escritor legado recusado; Interreg/POCTEP compatíveis.
- Histórico e dados tenant preservados, nenhuma infraestrutura habitual acedida pelo gate, cleanup verificável. Evidência identifica separadamente fixtures, fonte pública real e limites da prova.
- Suites backend/frontend, build frontend e node --check dos JavaScript alterados; revisão independente e integridade dos normativos/SQL anteriores.

## Ativação e recuperação posteriores

A janela habitual terá plano próprio com preview, backup/restauro renovados, instalação explícita043, configuração do modo/política, prova da capacidade e aprovação autenticada da retoma. Recuperação operacional começa por suspender a fonte e conservar arquivo/recibos/histórico; não reativa writer v1 sobre dados v2 nem apaga revisões aceites. O ensaio deste incremento não substitui essa janela.
