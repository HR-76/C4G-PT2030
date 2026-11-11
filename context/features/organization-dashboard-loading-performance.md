# Entrada no dashboard da organização

Estado: Review — 29/10/2026. Implementado e validado localmente; medição PostgreSQL/HTTP real concluída, **sem ganho de latência demonstrado**.

## Pedido e âmbito

O utilizador reporta demora ao entrar no dashboard da organização cliente. A implementação atual aguarda um agregado autorizado com relatório, oportunidades privadas, catálogo central e validação final. Preservar os indicadores, relatório/CSV, isolamento, auditoria e sequência das fontes. A arquitetura multi-instituição aprovada não é alterada.

O diagnóstico do código encontra pedidos sem cancelamento no efeito React e sete consultas base sucessivas em `tenantSchemaSnapshot`. A investigação histórica C1 identifica metadados como custo dominante, mas não representa uma medição do runtime atual. Não assumir ganhos em segundos sem comparação.

## Implementação

1. Cancelar a leitura do dashboard ao desmontar, atualizar ou mudar identidade/organização, conservando a proteção de geração e a validação da organização na API. Apresentar o cabeçalho e navegação enquanto os indicadores carregam, sem mostrar zeros ou dados anteriores como atuais. Na rota, deixar concluir a operação protegida em curso e não iniciar as fontes seguintes se o cliente já desligou; o aborto HTTP não interrompe transações ou auditoria a meio.
2. Agrupar apenas as sete consultas base do catálogo tenant num statement fresco, seguindo o padrão já existente do catálogo central. Preservar SQL, parâmetros, tipos, ordenação, serialização e fingerprints. Manter todas as observações de segurança condicionais e verificações antes/depois de fronteiras privilegiadas; sem cache de autoridade, aumento de limites ou leases paralelas.
3. Regressões antes da implementação, verificações focadas, suites completas e build; registar falhas externas separadamente. Nenhuma migração, alteração de dados, commit ou deploy.

## Critérios de aceitação

- A consulta ativa recebe AbortSignal; a consulta substituída/desmontada é abortada e nunca publica dados de outro contexto.
- Quando a ligação HTTP termina, a rota aguarda a conclusão segura da etapa em curso e não inicia etapas posteriores; pedidos ligados continuam a executar todas as fontes e a validação final antes da resposta.
- O cabeçalho e atalhos aparecem durante a leitura; indicadores permanecem em carregamento até existir o agregado completo autorizado.
- Sete consultas base passam a uma por snapshot; cada chamada recolhe dados frescos. Erros ou resposta malformada falham de forma fechada.
- Snapshots e fingerprints preservam exatamente bytes, propriedades opcionais e tipos das consultas anteriores, incluindo schemas vazios e segurança condicional.
- Nenhum checkpoint, consulta de segurança adicional, decisão de acesso, evento de auditoria ou validação final é removido.
- Testes focados e sintaxe passam; suites/build são executados e resultados registados sem ocultar falhas preexistentes.

## Validação e limites

- Metadados: 28 regressões novas; antes da implementação, 26 PASS/2 FAIL esperadas (sete comandos e forma agregada ausente); depois, foco de catálogo/preflight/compatibilidade com 67 PASS. Os sete SELECTs e os 24 SELECTs condicionais de segurança anteriores foram congelados em fixture; bytes/hash, tipos, arrays vazios, propriedades opcionais, canonicalização PG17/18, drift e erros preservados.
- HTTP: cinco regressões de desconexão RED→GREEN, incluindo abandono em report/private/central/final e erro após desligar. Foco de scheduling e summary: 14 PASS. Servidor Express local com fontes controladas, sem PostgreSQL. Pedidos ligados continuam a exigir a validação final e a recusar totais parciais.
- Frontend: oito regressões inicialmente falharam; revisão acrescentou três falhas reproduzidas antes da correção de contexto/CSV. Foco final: 22 PASS. O componente interno tem identidade por utilizador/organização, evitando um render com indicadores anteriores antes do efeito de limpeza. Atualizar durante exportação não bloqueia exportações seguintes.
- Suite frontend completa: **414 PASS**, 58 ficheiros. Build: **PASS**. Sintaxe dos quatro ficheiros JavaScript backend deste incremento: **PASS**. Revisão independente da rota e do frontend: sem bloqueadores.
- Suite backend completa: **1715 PASS/1 FAIL/7 SKIP**. Baseline anterior à alteração de metadados: 1682 PASS/1 FAIL/7 SKIP; a mesma falha existente em `fundingEnrichmentPersistence.test.js`, «enrichment discovery defers every new identity until its complete known lookup», fora dos ficheiros alterados. Os sete SKIP continuam explícitos e não constituem validação PostgreSQL.

Evidência: `output/dashboard-loading-backend-red.log`, `output/dashboard-loading-backend-focused.log`, `output/dashboard-loading-disconnect-red.log`, `output/dashboard-loading-disconnect-focused.log`, `output/dashboard-loading-frontend-red.log`, `output/dashboard-loading-frontend-review-red.log`, `output/dashboard-loading-frontend-focused.log`, suites em `output/dashboard-loading-{backend,frontend}-final.log` e build em `output/dashboard-loading-build.log`.

**Ganho comprovado: sete para uma consultas base por snapshot**, menos seis chamadas; cada snapshot continua fresco e conserva as consultas de segurança adicionais. A redução de comandos não equivale a uma redução percentual do tempo do dashboard. O cancelamento não interrompe uma transação em curso: evita as etapas posteriores quando a desconexão é observada.

Na primeira entrega não se executou o novo SELECT num servidor PostgreSQL. A equivalência foi verificada com resultados controlados e o descodificador JSON de `pg`, preservando o texto dos SELECTs anteriores. A tentativa inicial de inspeção no Brave terminou porque a ferramenta de computer-use não conseguiu confirmar o URL atual; essa entrega não incluiu verificação visual nem medição browser. Não se efetuaram migrations, alteração de dados, configuração, reinícios, deploy ou operações Git nessa entrega. A medição posterior pedida pelo utilizador está registada abaixo.

Gates que criam infraestrutura ou executam SQL de preparação requerem autorização própria e âmbito isolado, segundo AGENTS.md. A sequência de parceiros anteriormente parada e os seus manifests/evidências permanecem intactos.

O passo de medição pendente foi executado no seguimento abaixo.

## Medição pedida em 29/10/2026

O utilizador pediu medir o ganho real após a implementação. Frontend/API/Keycloak estavam parados; PostgreSQL nativo estava ativo. O ensaio arranca temporariamente a composição local existente e Vite nas portas habituais livres, retomando apenas os contentores de identidade existentes. Não executa instalação, migrations, seed, grants, mudanças de contas ou importações. O worker de recolha não é iniciado. Login e auditoria normais da aplicação são os únicos efeitos de escrita esperados.

Método preparado em `test/integration/dashboard-loading/`: observador apenas no processo de teste, instalado antes dos consumers de metadados; `AsyncLocalStorage` por pedido de dashboard marcado como baseline/candidate. A baseline reconstruída usa os sete SELECTs congelados da versão anterior, no mesmo cliente, mantendo todos os followups/checkpoints; candidato usa o SELECT agregado atual. Nenhum ficheiro de produção é substituído. Ambos usam a mesma API, pools, sessão OIDC, permissões, limites e dados. Regressões do adaptador provam igualdade, frescura, propagação de falhas e isolamento da variante.

Um aquecimento por variante, dez pares alternados AB/BA sequenciais, mais três entradas na página atual. Medir HTTP completo, etapas, snapshots/comandos e igualdade de fingerprints/resposta (excluindo apenas timestamps de geração e cursores assinados voláteis); medir cabeçalho e indicadores visíveis separadamente. Bloquear mutações de negócio no browser. Guardar apenas contagens, tempos, hashes e capturas, sem credenciais, cookies, SQL, argumentos ou respostas privadas nos logs. Interromper na primeira falha de autoridade, erro HTTP ou divergência.

Critérios: 20 pedidos medidos 200, fingerprints e resultados equivalentes, candidato com uma consulta base por snapshot, frontend sem erro e quatro indicadores apresentados. Publicar tempos observados mesmo que o ganho seja pequeno ou negativo. Amostra C1 local sem concorrência não demonstra capacidade de produção; tempos frontend representam a versão atual, não uma reconstrução da UI anterior. No final fechar apenas os servidores de teste criados pelo ensaio.

### Resultado da medição real

**A redução de comandos não acelerou o pedido HTTP neste ensaio.** Dez pares alternados, excluindo um aquecimento por variante:

| Medida | Baseline de sete consultas | Candidato de uma consulta |
| --- | ---: | ---: |
| Pedidos medidos | 10 | 10 |
| Mediana HTTP | 4635,06 ms | 4735,21 ms |
| Média HTTP | 4615,72 ms | 4693,67 ms |
| Mínimo–máximo | 4440,73–4749,22 ms | 4469,52–4904,64 ms |
| Consultas base / pedido | 126 | 18 |
| Consultas de segurança adicionais / pedido | 378 | 378 |
| Snapshots frescos / pedido | 18 | 18 |

A mediana aumentou **100,15 ms (+2,16%)** e a média **77,95 ms (+1,69%)**. O candidato foi mais rápido em dois dos dez pares, com diferenças por par entre −268,59 ms e +76,21 ms de poupança. Não atribuir o pequeno aumento exclusivamente à alteração: amostra local e carga do host não controlada; a conclusão suportada é ausência de melhoria consistente, não benefício produtivo.

Todos os **20/20 pedidos medidos** e os dois aquecimentos terminaram 200, sem falhas de snapshots ou pendências. As quatro etapas foram executadas uma vez em todos os pedidos, com validação final. Todos os resultados funcionais e fingerprints coincidiram; apenas `generatedAt`, `nextCursor` e `previousCursor` foram excluídos do digest de comparação da resposta. Os cursores não foram validados por equivalência de bytes. A diferença de comandos **126→18**, menos 108, foi observada no PostgreSQL real.

Tempos médios por etapa do candidato: report **1681,69 ms**, resumo privado **1174,97 ms**, catálogo central **48,75 ms** e contexto final **1274,53 ms**. Os três percursos tenant continuam a dominar a espera. Estes spans são etapas sequenciais, não medidas isoladas de CPU/SQL.

No Chrome atual, três entradas completas no dashboard: cabeçalho visível em mediana **877,44 ms** e indicadores em **5723,24 ms** (intervalo 5706,41–6229,01 ms). Houve um pedido de resumo concluído por entrada, zero erros JavaScript e oito tentativas de mutações automáticas bloqueadas pelo harness. Capturas 1440/390 inspecionadas: quatro indicadores e conteúdo preservados, sem overflow mobile. Esta medição mostra o comportamento atual; não compara a UI anterior.

Evidência integral: [results.json](../../output/playwright/dashboard-loading-native-2026-10-29T01-16-10-172Z/results.json), [desktop](../../output/playwright/dashboard-loading-native-2026-10-29T01-16-10-172Z/dashboard-1440.png), [mobile](../../output/playwright/dashboard-loading-native-2026-10-29T01-16-10-172Z/dashboard-390.png). Observador: sete testes locais PASS em `output/dashboard-loading-observer-tests.log`; sintaxe dos três ficheiros de ensaio PASS e revisão independente do método concluída. Nenhuma alteração adicional de código de produção nesta medição.

### Arranque, preservação e limites

A primeira tentativa terminou antes de login/amostras com `OAUTH_RESPONSE_IS_NOT_CONFORM`: o proxy devolvia 502 porque a configuração efetiva encaminhava o realm nativo para `c4g-native-email-idp`, enquanto o script antigo arrancava apenas o Keycloak F2. Foram retomados os contentores **existentes** `c4g-native-email-pg` e `c4g-native-email-idp`; HTTPS voltou a responder 200 com o issuer esperado. Não se alterou o proxy, certificados, configurações ou contas. [Tentativa preservada](../../output/playwright/dashboard-loading-native-2026-10-29T01-13-43-562Z/results.json).

Docker Desktop e os serviços de identidade foram arrancados; API/Vite de teste foram fechados no fim. Ausência de listeners nas portas 3000/5000/5285 confirmada após o fecho, e processo de medição terminou com exit 0. Worker de recolha, migrations, seeds, grants, importações, deploy e operações Git não foram executados. O ensaio emite apenas leituras funcionais e o login/auditoria normais; os resultados de negócio permaneceram equivalentes entre amostras.

Limites: baseline reconstruída por adaptador de teste, mesmo collector/followups e cliente; observação acrescenta proxy/hash/timing comum às duas variantes. HTTP inclui proxy Vite, transporte local e parsing; pools/metadados aquecidos, uma entidade e dados atuais (533 oportunidades, zero candidaturas), sem concorrência nem worker de recolha ativo. Não demonstra entrada fria, carga de produção ou isolamento multi-entidade adicional.

Próximo passo: reduzir o custo dos três percursos tenant do agregado, mantendo todas as fronteiras de autoridade e auditoria; voltar a medir antes de declarar a demora resolvida.
