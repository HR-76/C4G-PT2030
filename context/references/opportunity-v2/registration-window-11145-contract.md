# Registo do pacote e preparação da janela da 11145

Pedido confirmado em 31/10/2026. Estado: Review — implementação e preparação validadas; instalação/aceitação habituais pendentes.

## Âmbito autorizado

Registar no repositório o pacote final medido no incremento de aprovação/suspensão EU, preparar a janela da chamada CASCADE:11145, atualizar a observação oficial e o preview do catálogo habitual e produzir backups próprios com restauro isolado comprovado. A preparação pode pausar de forma delimitada os processos locais verificados para obter uma cópia consistente, restaurando depois a saúde habitual. Não eliminar trabalho pendente nem terminar processos/sessões desconhecidos.

Este incremento não aplica SQL candidato às bases habituais nem aceita/publica a 11145. A aprovação do plano factual continua a exigir sessão administrativa atual e o digest exato; não é fabricada a partir deste pedido. Não alterar credenciais, grants, flags de fonte ou dados de negócio. Sem commit, push ou deploy.

## Critérios de aceitação

1. Registo determinístico dos sete SQL centrais e da capacidade tenant, com ordinais/checksums/fingerprints medidos e dependências explícitas. Preservar bytes/ledgers históricos e a admissão normal da baseline035/033 enquanto o pacote estiver pendente. Nunca introduzir execução automática no arranque ou fallback de segurança.
2. Ensaio isolado do pacote registado através das portas normais de migração/preflight/autoridade, distinguindo registo local de aplicação real. Provar preservação do prefixo histórico, dados/vínculos e leitores compatíveis; validar regressões, suites e build apropriados.
3. Observação atual da API oficial da 11145, limitada a essa identidade, com bytes/hash/metadados preservados em novo artefacto. Comparar com o normativo sem o alterar. Não inventar moeda nem outros factos; total120000 e sete prazos são expectativas a verificar, não valores forçados.
4. Preview READ ONLY atualizado do catálogo habitual com identidade/revisão/rowVersion, CAS, campos factuais, correções/resoluções e contagens/checksums privados. Confirmar baseline, fonte e tenants abrangidos. Guardar prova nova sem sobrescrever a histórica; nenhum snapshot privado ou segredo em relatórios públicos.
5. Backups próprios em diretório com ACL restrita, incluindo bases/configuração necessárias; exportação consistente, hashes, esquema, roles/ACLs, sequências e dados verificados no restauro isolado. Nenhum restauro in-place habitual. O cluster temporário é identificado, limitado a loopback e encerrado; cópias preservadas.
6. Pausa local apenas sobre árvore de processos/portas verificada, com ausência de trabalho ativo ou pendente não recuperável e sessões externas. Revalidar dados antes/depois, retomar serviços mesmo em falha de preparação e comprovar saúde. Não usar a pausa anterior como prova da nova janela.
7. Plano de execução e recuperação concreto: pré-condições, pacote exato, backups, validade temporal do preview, paragem perante drift, ordem de aplicação, autoridade/aprovação/quiescência e condições de retoma. Registo não significa ativação; depois de EUv2 aceite permanece proibida a retoma do writer v1.

## Sequência

Investigar registo/admissão e helpers existentes; registar o pacote com testes; obter observação oficial e preview; ensaiar migração registada isolada; executar preparação/backup/restauro durante pausa verificada; conferir retoma, atualizar relatório/descritor e indicar o passo de execução autorizado que fica pendente.

## Resultado

[Relatório e evidência](../../reviews/opportunity-data-standardization/registration-window-11145.md): pacote036–042/034 registado explicitamente,12 checks SQL PASS,388 hashes estáveis, preview oficial renovado, backup/restauro lógico de216 tabelas PASS e retoma em57,222 segundos. Configuração e baseline035/033 preservadas. Backend2141 PASS/7 SKIP, frontend491 PASS/build PASS e sintaxe41 PASS. [Descritor](registered-window-11145.json) e [runbook](window-11145-runbook.md).

O restauro comprova dados/esquema/ACLs; autenticação num novo destino exige prova própria antes de uma recuperação operacional. A aceitação futura exige executor delimitado com arquivo canónico real: a flag de controlo/aprovação não liga automaticamente `canonicalV2Enabled`/`candidateArchive` no worker habitual. Essa limitação está expressa no plano; não foi contornada por fixtures nem por promoção do preview local.
