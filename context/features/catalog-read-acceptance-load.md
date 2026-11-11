# GCNI — correção da admissão e leitura isolada

Estado: Complete neste incremento — aceitação isolada aprovada em 01/11/2026. Melhoria global In Progress; ambiente habitual e fontes não ativados.

## Resultado
O contrato explícito do pacote candidato permite às sessões GCNI/OIDC funcionar com 046–048. O manifesto habitual continua a recusá-lo. A leitura deixou de transferir/reconstruir toda a geração: usa cabeçalho publicado, índice compacto e payloads selecionados por identidade. Não foram alteradas migrações SQL nem fingerprints aprovados.

## Segurança e leitura
- Capacidade de composição isolada, ligada ao nome exato da base e aos dois logins dedicados; sem opção HTTP ou ativação por variável de ambiente. Ledger completo, checksums, marcador, versão PostgreSQL e fingerprints do núcleo/catálogo verificados. Depois do lock, o coordenador volta a verificar a segurança de autoridade contra a evidência fixada pelo fingerprint completo.
- Cada leitura valida o esquema, os privilégios e o cabeçalho publicado. Membership/sessão são consultadas antes e imediatamente antes de devolver dados. A cache nunca guarda decisões de autorização ou admissão.
- As migrations existentes selam geração, itens e payloads; publicação valida a contagem e aprovação. A admissão fresca verifica também essas funções/triggers. Esta garantia permite reutilizar dados imutáveis sem varrer todos os itens em cada pedido. A primeira construção confirma contagem/identidades e referências; cada payload selecionado é reconstruído/verificado antes de entrar na cache.
- Índice temporal derivado dos mesmos factos e da mesma função da projeção completa; testes de igualdade em instantes exatos, datas civis e mudança de intervalo. Filtros Unicode, montantes decimais exatos, keyset25, snapshots15min e limites HTTP1MiB/512KiB preservados.
- Preparação concorrente única do índice, depois de libertar a ligação dos pedidos em espera. Cache de dados contabilizada até 64 MiB, máximo 128 entradas e 8 filtros por índice; objetos congelados. Este orçamento de dados serializados não representa uma medição exata do heap V8. A consulta continua limitada a 10 000 oportunidades.
- Filtragem/ordenação sobre índice compacto limitado em memória; leitura SQL das fichas por identidade. Não foi introduzida uma nova projeção SQL nem uma migração 049. A escolha evita reescrever046–048 e foi validada ao volume contratado.

## Aceitação
Backend: 2443 PASS, 0 FAIL, 7 SKIP; frontend 576 PASS em73 ficheiros e build PASS. PostgreSQL: 36 controlos PASS. OIDC real local, TLS/PKCE, cookies seguros, administrador e cliente, tabela/ficha no browser, paginação, negação entre organizações, alteração de privilégios e revogação: 10 controlos PASS.

Carga: dez pedidos concorrentes; pools catálogo/autoridade max 2 inalterados; cinco execuções de dez pedidos por cenário e dez aquecimentos.200 pedidos medidos +40 aquecimentos, sem erros.20 séries recalculadas por analisador independente. Alvo p95servidor<=500ms em cada execução após aquecimento, não SLA produtivo.

| Volume | Recurso | Sucessos medidos | Erros aquecimento | p95 agregado ms | Máximo p95 das5 execuções ms |
|---:|---|---:|---:|---:|---:|
| 27 | Lista | 50/50 | 0 | 412.24 | 413.92 |
| 27 | Ficha | 50/50 | 0 | 402.22 | 409.50 |
| 10000 | Lista | 50/50 | 0 | 461.44 | 495.72 |
| 10000 | Ficha | 50/50 | 0 | 396.15 | 454.31 |

O ensaio anterior à correção tinha p95 de 3817,19 ms/3734,75 ms com 27 registos e 100% de respostas 503 com 10 000. O primeiro ensaio desta correção já serviu todos os pedidos medidos, mas teve seis recusas no aquecimento e p95 da lista até 553,45 ms. A partilha da preparação e a eliminação da varredura repetida corrigiram esses bloqueios. As tentativas ficam preservadas; não foram relaxados critérios ou limites. A comparação27→10000 mede escala, não regressão entre versões. A pior série da lista ficou a4.28ms do limite: existe margem reduzida, a verificar na infraestrutura de destino antes de promoção.

## Autorrevisão
Veredicto: ready to close este incremento isolado. Corrigidos: admissão candidata incompatível com sessões; carga integral; ocupação concorrente das ligações; mutabilidade acidental da cache e crescimento com gerações vazias. O ensaio foi também corrigido para inserir o primeiro ponteiro ativo e confirmar a publicação, usar o link real da ficha e recalcular corretamente o arredondamento dos quantis. A validação negativa mantém recusa do pacote no caminho habitual e recusa de deriva de permissões no caminho isolado.

Não existe certificação de federação externa com uma instituição: foram usadas identidades sintéticas num Keycloak real local. O ensaio de carga usa sessões sintéticas assinadas; o percurso OIDC real foi ensaiado separadamente. A topologia é uma máquina local, não produção. A fixture herdada utiliza pg_read_all_data nas leituras centrais gerais; os leitores do catálogo e de membership têm logins limitados próprios. Nenhuma destas limitações autoriza promoção automática.

Fontes QUIESCED, zero funding runs, histórico preservado, clusters próprios parados e contentores próprios removidos. Sem alterações de contas habituais, credenciais, fontes, migrações aplicadas ou deploy.

Próximo passo: preparar o plano de promoção controlada para o GCNI habitual, com reversão e monitorização, sem o executar.
