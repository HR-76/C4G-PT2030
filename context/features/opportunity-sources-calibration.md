# Plano — calibração das fontes de oportunidades

Estado: In Progress, 28/10/2026. Plano autorizado pelo utilizador para implementação integral com rigor e enriquecimento. [Diagnóstico e evidências](../research/opportunity-sources-calibration-2026-10-28.md).

Decisões confirmadas nesta sessão: universo completo das fontes aprovadas, relevância por entidade após ingestão; Portugal 2030 publicado separado de planos previstos; avisos internos ao gestor para mudanças de prazo, encerramento/cancelamento e condições de financiamento, preservando a revisão original. Sem autorização de deploy. Cadência produtiva e gates externos mantêm validação própria antes da ativação.

## Resultado pretendido

Catálogo central com cobertura mensurável, frescura conhecida, estado temporal correto e informação suficiente para decisões de candidatura. A quantidade é consequência da cobertura aprovada, não uma meta artificial. A arquitetura aprovada mantém API/worker separados, identidade e catálogo centrais, isolamento integral por organização e matching determinístico.

Preservar UUIDs, revisões, observações, correções manuais, pedidos idempotentes e vínculos das candidaturas. Não eliminar nem arquivar automaticamente um registo por estar ausente de uma amostra. Não reativar serviços legados UBI.

## Fases e critérios de aceitação

### P0 — restaurar operação e tornar a saúde verificável

1. Investigar logs de saída e supervisão, sem expor segredos. Confirmar processo, modo, heartbeat, fila, execução e outbox.
2. Testar e recuperar expiração/retoma do pedido em fila, respeitando deadline, fences e idempotência. Não alterar status manualmente para contornar o motor.
3. Health deve distinguir OFFLINE, STANDBY e PROCESSING e detetar falta de progresso. Mostrar na página a última recolha bem-sucedida e a idade do catálogo.
4. Só após preparação/testes, retomar worker e executar atualização controlada no âmbito aprovado. Não prometer importação completa nesta fase.

Aceitação: worker ausente/standby visível; pedido não fica indefinidamente «em fila» sem diagnóstico; recuperação não duplica aplicação; falha de uma fonte fica identificada; histórico conservado. Regressões de crash, pedido expirado, perda de autoridade e restart. Causa da paragem registada, ou explicitamente inconclusiva com observabilidade para a próxima ocorrência.

### P1 — substituir a amostra por varrimento durável e mensurável

1. Separar «ciclo de sincronização» de «lote de trabalho». Manter limites de tempo, bytes, requests e taxa por lote, mas persistir cursor/partição/progresso para continuar depois dos primeiros 100.
2. Validar empiricamente semântica de totalResults, desempate, alterações entre páginas e limites da API. Guardar assinatura do filtro/versão do adaptador; alteração de contrato não retoma cursores incompatíveis.
3. Descoberta por todos os programas aprovados, com prioridade de atualização a abertas/prazos próximos. CORDIS/Horizon e Erasmus tornam-se vistas/recortes da origem europeia canónica; conservar códigos/histórico antigos.
4. Stage durável por página/lote; não perder páginas anteriores quando a seguinte falha. Repetição idempotente e recuperação após crash em qualquer fronteira.
5. Persistir total remoto observado, recebidos, únicos, duplicados, excluídos por motivo, inválidos, criados, atualizados, inalterados, falhas e continuação. SUCCESS só significa conclusão do âmbito; limite atingido significa PARTIAL/continuação pendente.
6. Rever migrações aditivas, grants, preflight, leases e deadline global de cinco minutos: não aumentar o volume dentro do mesmo job de 150 segundos como solução.

Aceitação: fixture de 1200 resultados percorre todas as páginas, incluindo duplicados e exclusões; cada identity criada uma vez; repetir o ciclo sem mudanças não cria revisões; interrupção após a página 3 retoma corretamente; 429/backoff e mudanças de ordem não causam omissão silenciosa; contagens fecham por etapa. Prova pública limitada compara amostras estratificadas/contagem com o portal; divergências ficam explicitadas, sem prometer snapshot estável que a API não oferece.

### P2 — calibrar datas, estado e atualização de registos existentes

1. Modelar estado publicado (aberta, prevista, encerrada, cancelada, desconhecida) separadamente do lifecycle administrativo e da validação editorial.
2. Preservar prazos/rondas e hora/fuso quando fornecidos; escolher a próxima data aplicável sem perder as restantes. Quando só existir data civil, não inventar uma hora.
3. Atualizar identidades já conhecidas mesmo após saída do conjunto de descoberta aberta: prorrogações, encerramentos/cancelamentos e informação contraditória. Ausência só sustenta alerta/revisão após varrimento completo e política confirmada.
4. Dashboard/listagem distinguem total histórico, abertas, previstas, encerradas, desconhecidas e desatualizadas. OPEN exige abertura já ocorrida quando conhecida; mostrar incerteza restante.
5. Manter revisão original da candidatura e apresentar alteração relevante da fonte para decisão do gestor; não reescrever silenciosamente snapshots ou critérios já confirmados.

Aceitação: datas futuras não contam como abertas; POCTEP 9 encerra e 10 permanece no período atual em 28/10; multi-deadline, meia-noite, mudança de hora, prorrogação e cancelamento testados; candidaturas mantêm UUID/revisão; correções manuais continuam a prevalecer com conflitos explícitos.

### P3 — completar informação e taxonomia

1. Validar IDs de programas contra metadados oficiais, versionar mapeamento e alertar para desconhecidos. Resolver o desvio CEF/DIGITAL na origem comum de forma testada, sem UPDATE genérico no histórico.
2. Validar endpoints oficiais de detalhe; recolher orçamento do aviso, apoio por candidatura quando efetivamente declarado, moeda, taxa, regiões, beneficiários, consórcio, documentos e links de submissão.
3. Proveniência por campo, texto/fonte e instante de observação. Armazenar material de origem de modo limitado, com política de retenção/uso; não registar dados privados ou payloads indiscriminadamente.
4. Ligação aos critérios e matching: dados factuais versionados, confirmação humana para regras interpretativas, sem IA no caminho principal. Campo ausente permanece desconhecido; orçamento de aviso nunca é convertido em apoio por projeto.

Aceitação: amostras de programas/tipos distintos confrontadas com fontes oficiais; nenhuma elegibilidade inventada; documentos/links válidos e proveniência rastreável; conflitos e incompletude visíveis; taxas/valores exatos, com regras de null/unidade/moeda.

### P4 — cobertura Portugal 2030 e consolidação dos restantes adaptadores

1. Spike Portugal 2030: testar contrato de `/wp-json/avisos/query` (paginação, filtros, IDs, alterações, total, detalhe/download), distinguir avisos publicados do plano previsto, confirmar condições de uso/estabilidade.
2. Escolher API oficial como via preferencial se o spike validar o contrato; XLSX oficial como importação administrativa complementar, com preview/aprovação/deduplicação. Não usar o motor privado existente como motor central.
3. Implementar proveniência/identidade/leitura central para a nova origem; o INNER JOIN atual a funding_identity não pode ocultar os novos avisos. Migração aditiva, histórico anterior preservado.
4. POCTEP: contratos por tabela/convocatória, contagem real de requests, datas/horários, detetor de alterações de estrutura e atualização dos encerrados conhecidos.
5. Interreg Europe: manter cobertura explícita e zero válido; descoberta monitorizada do ficheiro oficial. Outros programas Interreg apenas mediante inclusão explícita no âmbito, não inferidos como já cobertos.
6. Erasmus: rotular cobertura F&T/EACEA; via agências nacionais como incremento separado após validação de fonte/contrato. Não preencher o catálogo com projetos CORDIS confundidos com avisos.

Aceitação: avisos PT2030 visíveis no catálogo comum para organizações autorizadas; duplicados entre API/XLSX não multiplicam candidaturas; origem/data/status consistentes; leitores tenant não escrevem dados centrais; exportação e proveniência mantêm isolamento. Zero Interreg não é alarme automático quando oficialmente esperado.

### P5 — automatização, operação e entrada em produção

1. Agendamento central por fonte, com jitter, backoff, limites de concorrência e circuit breaker. Cadência inicial proposta: europeias diariamente, abertas/prazos próximos mais frequentes se quotas permitirem; POCTEP/Interreg diariamente. Confirmar política antes de ativar.
2. Definir autoridade de serviço própria para jobs agendados. Não reutilizar um utilizador C4G artificial: o fluxo atual depende de requested_by e revalida esse administrador em cada passo.
3. Supervisão de processo e alertas por heartbeat/progresso, idade da última sincronização completa, erros de esquema, cobertura parcial e desvio de contagens; mensagens operacionais com dados mínimos.
4. Composição produtiva própria: substituir guardas de ensaio por configuração validada/segura, sem simplesmente as remover. Planeamento de capacidade, rollout por fonte e possibilidade de parar novas recolhas preservando histórico.

Aceitação: relógio controlado prova agenda sem duplicação; shutdown/restart e revogação seguros; alerta simulado por fonte/worker; ensaio isolado de migrações/HTTP/worker com autorização própria; ativação e recolha reais apenas no âmbito aprovado. SLO inicial proposto: última sincronização completa <=24h para fontes diárias; alerta após ciclo falhado ou intervalo excedido, sujeito às quotas acordadas.

## Sequência recomendada

P0 → P1 → P2. Fazer o spike Portugal 2030 após P0 para esclarecer o contrato; implementar a nova origem depois das bases de identidade/observabilidade de P1/P2. P3 é necessário para melhorar qualificação, não só descoberta. P5 fecha a passagem de recolha manual local para serviço operacional. Cada fase deve ter contrato e critérios confirmados antes de código; não executar tudo como uma alteração única.

## Decisões de produto e operação

- Confirmado: todas as oportunidades dos programas/fontes aprovados, com filtros de relevância por entidade depois da ingestão.
- Confirmado: Portugal 2030 com avisos publicados e planos previstos separados; via automática após validar o endpoint, mantendo XLSX complementar.
- Cadência/SLO e destino de operação: validar quotas e ambiente antes de agendar/ativar.
- Confirmado: avisos internos ao gestor para mudanças de prazo, encerramento/cancelamento e condições de financiamento. Sem atualização silenciosa de revisões confirmadas.

Decisões confirmadas por resposta explícita do utilizador nesta sessão. Cadência, ativação produtiva e gates isolados continuam sujeitos ao seu âmbito próprio.

## Validação transversal

Regressões antes de correções; testes focados, suites e build. Gates de migração/integração apenas em infraestrutura isolada autorizada. Comparar antes/depois UUIDs, revisões, relações e dados tenant; recusar migração destrutiva. Verificar APIs de consulta/administração/worker e cliente api.js. Concluir com UI desktop/mobile e comparação de cobertura por fonte, não apenas contagem agregada.

## Incremento implementado — 28/10/2026

- P0: heartbeat com progresso real da fila; estados OFFLINE/STANDBY/PROCESSING/STALLED/DEGRADED/UNKNOWN; projeção pública sem PID, instalação ou erros internos. API de estado administrativa mantém autorização. Readiness local deixa de aceitar standby como processamento.
- Novos pedidos recusados quando o worker não está disponível, depois da autorização e da consulta idempotente. Confirmar um pedido já persistido continua permitido. A interface conserva o histórico, mostra diagnóstico e suspende novas recolhas. Última recolha completa é consultada separadamente de execuções recentes/limitadas, sem depender da janela de 100 execuções.
- Worker local retomado; verificação READ ONLY às 21:52:47Z confirma PROCESSING, progresso recente, pedido antigo reconciliado pelo motor para FUNDING_EXECUTION_EXPIRED e 119 identidades preservadas. Causa original da paragem inconclusiva. Sem atualização SQL manual, nova migração Dev, nova recolha pública integral ou deploy.
- P1, apenas porta do conector: cursor versionado vinculado à seleção/tamanho de página/data de referência, callback de checkpoint por página, total remoto e contagens de duplicados. Mantém quatro páginas/100 resultados por lote. Recusa páginas curtas incompatíveis com o total anunciado. Testes sintéticos percorrem 1200 resultados e retomam após falha na página 4 a partir do checkpoint da página 3.
- **P1 ainda incompleto:** worker/repositório não persistem estes checkpoints nem criam lotes seguintes. Não foi alterada a política live nem removido o limite efetivo da aplicação. A API remota usa paginação mutável, não um snapshot garantido; validação de estabilidade/assinatura do filtro e contagens entre lotes continuam necessárias. P2–P5 pendentes.

Validação final deste incremento: 52 testes focados PASS; backend 1594 PASS / 0 FAIL / 7 SKIP preexistentes; frontend 358 PASS; build PASS; sintaxe JavaScript/PowerShell PASS. Chrome com API sintética: desktop 1440 e mobile 390, diagnóstico visível, cinco ações suspensas e sem overflow. Evidência em `output/funding-audit-20261028/` e `output/playwright/funding-health-*.png`.

Gate PostgreSQL autorizado explicitamente pelo utilizador: `test/integration/funding-tenders/calibration-p0.ps1`, contentor próprio na porta 5558, dados sintéticos e manifest até 017 (prova do núcleo funding, não validação de uma futura migração P1). Segunda tentativa PASS em `output/funding-audit-20261028/gate-eb42da6783cf41f2bf922aaac483824d/`. Primeira tentativa `gate-ed9613c1cadd43be88a774596d5e1394` falhou no wrapper; escaping de ownership corrigido, contentor removido após confirmação explícita da etiqueta. Ausência de ambos os contentores confirmada. Histórico de evidências preservado.

## Atualização P1 — persistência concluída no código

O incremento anterior foi sucedido pela [implementação de persistência P1](opportunity-coverage-persistence.md), com migração 033, ciclos/checkpoints duráveis, sucessores/outbox atómicos e histórico agregado. Gate PostgreSQL autorizado PASS para 1200 resultados/48 páginas e repetição sem novas revisões; backend 1601 PASS/7 SKIP, frontend 359 PASS/build PASS e Chrome desktop/mobile PASS. A descrição de limitações do incremento anterior é histórica; checkpoints já são persistidos e encadeados quando o novo modo é ativado.

Dev continua no schema030, com 119 identidades e modo disabled. A ativação depende da revisão/autorização das migrações 031/032 antes de 033; não foi executada automaticamente nem confundida com o gate isolado. P2–P5 não iniciados.

### Ativação local concluída

Após autorização explícita, dependências031/032 revistas sem conflitos e migrações031–033 aplicadas em Dev. Preservadas119 identidades/135 revisões/1 membership; durable-v1 ativo, worker compatível e API/proxy saudáveis. Corrigido o preflight F12 de arranque para admitir exatamente as novas tabelas em033. Detalhes e validação no [registo P1](opportunity-coverage-persistence.md). As referências acima a ativação pendente são históricas. Não foi iniciada nova recolha real nem avançado para P2–P5.

### Primeira recolha real validada

Em28/10 às22:31Z, o utilizador iniciou EU Funding & Tenders na APP. Ciclo completo de45 páginas em81s:1119 recebidos,526 aceites,593 excluídos por prazo passado (confirmado por leitura pública independente),414 criados,112 inalterados e zero duplicados/inválidos/falhas. Catálogo119→533, incluindo histórico e2 POCTEP preservados. Evidências e interpretação no [registo P1](opportunity-coverage-persistence.md). O limite de100 deixou de truncar esta recolha.

### P2 — implementação e prova isolada concluídas

[Contrato e evidências P2](opportunity-temporal-calibration.md): classificação temporal independente do lifecycle, calendário completo com precisão da fonte, revisão durável dos identificadores conhecidos antes de alterar dados, tratamento conservador confirmado de versões contraditórias e aviso contextual nas candidaturas. Migração034 aditiva e gate autorizado PASS; backend1614 PASS/7 SKIP, frontend363 PASS/build PASS, Chrome desktop/mobile PASS. Leitura local533=262 abertas por datas+265 previstas+6 encerradas; não representa nova recolha.

Dev permanece033. Ativação034 e primeira recolha P2 preparadas e sujeitas a autorização específica; P3–P5 não iniciados. A verificação individual dos531 avisos EU conhecidos aumenta a duração do ciclo, mantendo limites por consulta e retoma persistida.

### P2 — ativação e primeira validação real concluídas

Após autorização explícita,034 foi aplicada localmente e API/worker reiniciados. Ciclo de28/10 às23:19–23:34Z:1119 resultados/45 páginas,531 conhecidos verificados,525 atualizados e6 contradições preservadas para revisão, sem falhas ou pendências. EstadoPARTIAL reflete essa revisão, não falta de cobertura.533 identidades e549 revisões anteriores preservadas;1074 revisões totais. Catálogo final261 abertas,265 previstas,1 encerrada e6 por confirmar;61 fichas preservam múltiplos prazos. Evidências e referências dos seis avisos no [registo P2](opportunity-temporal-calibration.md). As menções anteriores a ativação pendente são históricas.

### Revisão dos seis conflitos concluída

[Pesquisa e propostas por aviso](../research/opportunity-source-conflicts-2026-10-28.md): quatro CEF encerrados em 07/11/2023; prazo ECHE 2027 retirado, último corte 24/03/2026 com OPEN ainda publicado; sessão ESC fechada após corte 22/09/2026, sem extinção da certificação. Confirmados pares SEDIA/CENTRICITY e discrepância entre horas indexadas e documentais. A pesquisa foi seguida pela [correção complementar P2](opportunity-source-resolution.md), concluída e ativada em 29/10 com autorização específica. Seis resoluções e revisões novas, 1074 anteriores intactas; schema 035, catálogo 533, zero sinalizações por confirmar. Backend 1632 PASS/7 SKIP, frontend 376 PASS/build PASS, Chrome e gate isolado PASS; leitor restrito e runtime reais validados. Próximo passo: P3 — enriquecimento, ainda não iniciado.
