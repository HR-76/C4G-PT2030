# GCNI — aceitação OIDC e carga com controlos duráveis

Estado: Review. Execução concluída; aceitação depende dos resultados abaixo. Pedido autorizado: integrar o adaptador durável no ensaio de autenticação e repetir aceitação funcional/carga. Apenas infraestrutura própria isolada, fontes QUIESCED, nenhuma promoção.

## Critérios
1. Opção explícita de ensaio durável, preservando os modos anteriores; leitor de política e operador usam ligações limitadas distintas, sem instalação em bases habituais.
2. Login real Keycloak local/TLS/PKCE, admin primeiro e cliente sintético na regressão. Tabela/ficha, paginação, isolamento organizacional, revogação de membership e controlos existentes continuam aprovados.
3. Nova composição fechada antes de reentrada, sessão OIDC preservada, bloqueio de geração retirada conservado; histórico PostgreSQL atómico. O reinício de processo/base já ensaiado permanece evidência separada.
4. Carga via HTTPS e sessão OIDC, 27 e 10000 oportunidades, lista e ficha, 10 pedidos concorrentes, 10 aquecimentos + 5 séries de 10 por cenário; pools catálogo/autoridade de leitura limitados a 2. Critério original: zero erros e p95 servidor <=500ms em todas as séries medidas. Registar frio/aquecimento separadamente; não aumentar limites para obter aprovação.
5. Evidências sem tokens/credenciais, recomputação independente dos resultados, estado final OFF e limpeza dos recursos próprios. Autorrevisão e limitações explícitas; autenticação institucional externa, failover e SLA produtivo não são certificados.

Próximo passo: implementar e executar o ensaio integrado isolado.

## Resultado e autorrevisão — 01/11/2026

Integração e execução do ensaio concluídas. Aceitação funcional PASS; aceitação de carga NOT_ACCEPTED. A promoção não está autorizada nem tecnicamente aceite por este resultado.

O harness passa a oferecer -Durable e -Load explícitos. Os modos anteriores mantêm-se disponíveis. A política usa PostgreSQL com ligação de leitura sem escrita e ligação de operador limitada; o operador continua local, sem rota HTTP. Catálogo e membership usam pools máximos de duas ligações. Keycloak local real, TLS, PKCE e cookies seguros continuam integrados na composição de autenticação GCNI com contas sintéticas.

Foram aprovadas 17 verificações funcionais/de execução: admin primeiro, cliente apenas na regressão sintética, tabela e ficha no browser, paginação, isolamento organizacional, reversão, sessão preservada, retirada de versões, falha/recuperação da monitorização, reentrada explícita da composição durável e revogação de membership. A verificação LOAD_MEASUREMENT_COMPLETED confirma apenas execução da medição, não aprovação do desempenho. A recomposição deste ensaio não é um novo teste de reinício físico: esse teste foi executado na etapa anterior.

Carga: 27 e 10000 oportunidades, lista/ficha, dez pedidos concorrentes; quatro cenários com dez aquecimentos e cinco séries de dez pedidos. Total: 200 medições e 40 aquecimentos, sem erros; respostas verificadas, tempos HTTP e de servidor separados, preparação de dados e pedidos iniciais a frio registados separadamente. Os valores de todas as séries foram recomputados independentemente. O critério de 500 ms não foi alterado.

Autorrevisão: needs changes: performance acceptance not met. A recomputação independente foi alinhada com a regra de arredondamento positiva usada na apresentação JavaScript (uma diferença inicial de 0,01 ms entre linguagens, sem alterar amostras ou resultado). Teste de regressão impede que um HTTP 200 com corpo inválido ou tempo ausente conte como sucesso. Suite backend 2462 PASS / 7 SKIP / 0 FAIL; sintaxe JavaScript e PowerShell PASS. Não foram alterados o algoritmo de leitura, as regras de autorização, migrações habituais, limite de resposta ou frontend. A compilação controlada utilizada foi a já validada na etapa anterior. Os sete testes ignorados não contam como aprovações.

Limites: este ensaio usa um primário PostgreSQL em contentor local e federação Keycloak sintética; não certifica IdP institucional externo, HA, restauro ou SLA produtivo. A carga usa a conta admin, a listagem padrão e uma ficha por volume; filtros variados, carga distribuída entre organizações e comparação com os restantes percursos habituais continuam por validar. A carga anterior usava sessões sintéticas assinadas e PostgreSQL nativo: não é uma comparação equivalente para atribuir a diferença exclusivamente à persistência. Sem instrumentação por componente, a causa do custo adicional ainda não está isolada. Não foi repetida a carga seletivamente para obter um resultado favorável.

Estado final: exposição OFF, fontes QUIESCED, zero recolhas; os dois contentores próprios foram removidos. Sem promoção, publicação de conflitos ou reativação de fontes. Admin continua a primeira coorte pretendida; decisões de destino, responsáveis, recuperação, janela e alertas continuam pendentes como anteriormente acordado.

Próximo passo: medir separadamente o custo da autenticação, dos controlos duráveis e da leitura, corrigir o ponto limitante sem reduzir segurança e repetir a carga isolada.
