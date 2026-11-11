# Preparação da ativação por fonte

Pedido confirmado em 31/10/2026, após S6. Estado: Review — critérios de preparação verificados; ativação pendente. [Relatório e limitações](../../reviews/opportunity-data-standardization/activation-preparation.md).

## Âmbito autorizado

Preparar composição operacional opt-in para publicar candidatos v2 com autoridade central atual, aprovação durável vinculada ao preview e auditoria transacional. Produzir preview dos dados reais em transações exclusivamente READ ONLY e um plano concreto de migração/recuperação por fonte. Ensaiar os controlos numa base PostgreSQL isolada. Não ativar fontes, aplicar SQL nas bases habituais, reiniciar serviços, registar migrações nos manifestos ativos ou publicar alterações Git.

## Critérios de aceitação

1. A composição exige autoridade C4G atual, arquivo verificado, plano/aprovação persistidos, revisão/mapping/digests exatos e fence válido. Perda de autoridade, revogação, divergência e replay incompatível falham antes do commit.
2. Aprovação e aceitação deixam eventos de auditoria operacionais na mesma transação; falha da auditoria desfaz a operação. Nenhuma rota pública ou writer ativo passa a aceitar v2 por omissão.
3. Preview real lê catálogo, identidades, correções/resoluções, disponibilidade dos arquivos e referências privadas mínimas, sem copiar dados pessoais ou snapshots privados para a evidência. Distingue candidatos normativos de recolha atual e não equipara ausência de prova a prontidão.
4. Cada fonte tem decisão explícita, impedimentos, dependências e sequência de ativação. POCTEP10 continua bloqueada; Portugal2030 exige cadeia documental/antivírus central comprovada; não inventar integração API nem identidade por semelhança de título.
5. Plano de migração fixa baseline, candidatos SQL, pré-condições, pausa/fence dos escritores, backup/restauro, ensaio, verificações, critérios de interrupção e recuperação sem apagar histórico. Fingerprints/checksums apenas medidos; manifestos ativos preservados.
6. Testes focados e prova PostgreSQL isolada exercitam autoridade real persistida, aprovação/revogação, auditoria, replay, concorrência e preservação; suites backend/frontend e build registados. Limitações OIDC/serviços/documentos ainda não integrados são explícitas.

## Plano de execução

Inspecionar contratos S2–S6 e mecanismos centrais existentes; integrar portas operacionais inativas e persistência aditiva candidata; executar preview real somente em leitura; ensaiar controlos isoladamente; rever e documentar prontidão e recuperação por fonte.
