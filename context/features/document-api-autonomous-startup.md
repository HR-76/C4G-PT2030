# AV-01 — Arranque autónomo da API documental

## Contrato autorizado (2026-10-25)

Arrancar por `backend/src/server.js`, com configuração externa, serviços F11/F9
existentes e worker independente. Não consumir jobs na API, migrar no arranque,
usar administração funcional ou importar módulos de teste na composição produtiva.
Readiness exige dependências verificadas; liveness não significa disponibilidade.
O encerramento deve drenar handlers e operações antes dos pools, ser idempotente,
limitado e observável, incluindo arranque parcial.

## Critérios de aceitação

- Processo real sem launcher: configuração completa, operação documental HTTP e
  persistência após reinício; configuração/schema/credenciais inválidos recusados.
- Storage controlado só em teste explícito; produção recusa essa seleção. R2 não
  será contactado na validação local desta fase.
- Recursos pertencem ao componente que os criou; nenhuma ligação injetada por
  outro proprietário é encerrada implicitamente.
- Não ampliar privilégios nem criar migrations sem decisão separada.

## Fronteira demonstrada nesta fase

O perfil API configurado em `config/opportunityRuntime.js` admite somente
`c4g_opportunity_tenant_runtime` e `c4g_f4_metadata_executor` (mais o role editorial
quando explicitamente selecionado). Na cadeia oficial Tenant 032, a experiência
descartável recusou `SET LOCAL ROLE c4g_document_runtime` com SQLSTATE 42501.
O role opportunity já permite outbox e auditoria, mas não INSERT documental.
Não se atribuiu à API o role do worker nem o writer genérico de auditoria.

A factory completa ficou inicialmente pendente da decisão de perfil documental API.
O estado atualizado está abaixo; a evidência inicial mantém-se preservada.

Evidência externa: `C:/Users/Utilizador/c4g-evidence/api-autonomous-composition/20261025-184124/`.

## Continuação autorizada — 2026-10-25, 19:13

O perfil documental foi autorizado e implementado como provisionamento separado:
login → agregador API → opportunity, metadata e document runtime, sempre SET,
sem INHERIT/ADMIN OPTION. Auditoria/outbox usam opportunity; a API não seleciona
worker ou writer genérico. Não houve alteração de migrations ou fingerprints.

A composição normal passou a construir a infraestrutura F11/F9 a partir da
configuração. Reutiliza o pool manager e binding API, repository, staging, scanner,
storage e serviços existentes. A saúde do worker é observada por HTTP loopback;
a API não consome jobs. Testes isolados comprovam falha fechada e cleanup.

AV-01 **continua aberto**: a resolução real do diretório Tenant faz SELECT direto
pela ligação Central. Em Central 030 descartável, authority runtime é recusado
em `organization` e central runtime em `tenant`, ambos 42501. A identidade física
da base, por sua vez, foi verificável. A operação restrita de resolução ainda não
existe no catálogo da autoridade. Não se usou administração funcional ou novos
grants Central para contornar essa fronteira.

Arranque autónomo positivo, operação HTTP e persistência após reinício pelo
entrypoint normal permanecem por provar. Testes com injeção não os substituem.
Evidência: `C:/Users/Utilizador/c4g-evidence/api-autonomous-composition/20261025-191321/`.

## Auditoria das tentativas HTTP na factory

Cada aceitação/acesso autorizado tem uma correlação gerada server-side e um
evento de auditoria correspondente. Pedidos distintos sobre a mesma versão
não podem reutilizar a mesma chave F7 com digests diferentes. A factory usa
evento + versão/documento + correlação para identificar essa tentativa.
Isto não cria uma nova operação documental: a chave estável fornecida ao serviço,
a validação de conteúdo e a recuperação da versão persistida mantêm-se inalteradas.
A rejeição F7 de uma chave repetida com digest diferente continua ativa.

## Fecho local — 25/10/2026

AV-01 concluído no âmbito local: Central 031/Tenant 032 oficiais, perfil pg-boss
limitado provisionado fora do startup, API `npm start` e worker independente.
OIDC real, intenção documental 201, encerramento SIGTERM/0, reinício real e replay
201 com a mesma versão e apenas uma linha persistida. Configuração inválida e
credencial incompatível recusadas pelo processo normal, com saída 1.

Corrigidos nesta prova o carregamento circular do entrypoint do worker, o fecho
da fila em falha de construção, o sinal de lifecycle ausente do catálogo do logger
e a colisão entre tentativas de auditoria na mesma versão. 77 testes direcionados
únicos aprovados; testes PostgreSQL da fila e processo autónomo preservados em
`C:/Users/Utilizador/c4g-evidence/api-autonomous-composition/20261025-195342/`.

Storage controlado apenas em configuração de teste; R2 histórico não repetido.
Uma tentativa anterior consultou o registry pelo notifier automático npm, fora
do âmbito. A exceção fica registada; a prova final desativou notifier, modo online
do npm e FreshClam. Não classificar todas as tentativas como totalmente isoladas.
Implantação/supervisão VPS e funcionamento com múltiplas réplicas não comprovados.
