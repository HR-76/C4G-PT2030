# Baseline de metas — preparação em 09/11/2026

Estado: **preparada, não iniciada**. Pedido: medir durante 30 dias e testar restauro isolado sem bases habituais; R2 real adiado. Nenhum período de 30 dias pode ser declarado completo antes de existirem dados e cobertura suficiente. As metas abaixo são hipóteses propostas para validação, não SLA nem aceitação automática.

## Fonte, âmbito e impedimento atual

Opção de teste preparada: [instruções e analisador](../../test/integration/baseline-test-option/README.md), com relatórios locais persistentes e execução manual diária em ambientes sintéticos descartáveis. Não é um ambiente de longa duração nem um coletor contínuo. Responsável e substituto, percursos e política de recolha permanecem **por confirmar**. A campanha de 30 dias ainda não começou. Não usar tráfego, credenciais ou bases habituais como fonte implícita.

O bootstrap atual usa exportadores OpenTelemetry em memória e rejeita configuração de exportadores de rede ([código](../../backend/src/observability/bootstrap.js)). O catálogo de métricas tem histograma HTTP com último limite explícito em 5 s ([código](../../backend/src/observability/metrics.js)); esse histograma, por si só, não permite verificar com precisão uma meta de 6 s. Também não demonstra medição da pintura no navegador. É necessário um coletor/armazenamento autorizado e instrumentos apropriados, ou uma fonte existente equivalente; não se deve inventar medições.

## Definição proposta da recolha

Medir 30 períodos contínuos de 24 horas após o primeiro ponto válido, guardar instantes UTC e apresentar datas em Europe/Lisbon. Preservar fonte, versão/build, janela, agregação, denominador, falhas, lacunas e alterações relevantes. Recolher métricas agregadas sem identificadores de pessoa, credenciais, tokens, conteúdo de documentos ou URLs assinadas. Nunca classificar lacunas como sucesso.

| Objetivo a avaliar | Evidência a recolher | Regra de análise proposta |
| --- | --- | --- |
| Abertura p95 ≤ 6 s | Duração até conteúdo principal visível e pintado, por percurso e classe de dispositivo, com sucesso/falha e contagem | Separar percursos/dispositivos; p95 dos sucessos e taxa de falha lado a lado. Não calcular p95 fiável sem amostra suficiente acordada. |
| API p95 ≤ 3 s | Duração por rota normalizada e método, resultado e contagem; sem IDs nas labels | Separar leituras, escritas e operações longas; p95 dos sucessos mais taxa de falha, sem ocultar erros ou timeouts. |
| Disponibilidade mensal 99,5% | Provas externas autenticadas e sintéticas do percurso essencial; tempo, sucesso, falha e ausência de amostra | `sucessos / tentativas válidas`; reportar cobertura, falhas e lacunas separadamente. Acordar intervalo, janela de manutenção e denominador antes de avaliar. |
| Segurança | Resultados de gates por release, data e criticidade das falhas, decisão e resolução | Contar cenários críticos aprovados e tempos de triagem/plano; falha ou ausência de gate não é sucesso. |
| Acessibilidade WCAG 2.2 AA | Inventário de percursos, auditoria automática e manual, navegador/tecnologia assistiva e falhas por critério | Avaliar percursos completos e estados; resultados automáticos não são prova completa de conformidade. |

Antes de iniciar: confirmar a lista de percursos, intervalo das sondas, origem do relógio, limiar de cobertura, número mínimo de amostras, política de exclusões e segurança dos dados recolhidos. Com poucos eventos ou lacunas materiais, resultado é **evidência insuficiente**, não PASS. Medições sintéticas só descrevem o ambiente e a carga sintética, não a disponibilidade ou latência produtiva. A meta C6 previamente aceite permanece independente.

## Restauro isolado executado

Relatório [slo-restore-synthetic-20261109](../reviews/slo-restore-synthetic-20261109/results.json): PostgreSQL 18 descartável, Central e dois tenants sintéticos, 27 verificações PASS e remoção do contentor próprio. A duração medida foi de **11,141 s**, iniciada antes dos três dumps e terminada após restauro e verificações selecionadas; inclui backups sintéticos e não inclui preparação da fixture.

Isto é um tempo técnico de laboratório, **não é RTO operacional**. Não inclui deteção, decisão, provisionamento de destino independente, objetos R2, corte de tráfego, admissão e validação funcional integral, ou volumes reais. Não permite medir RPO, pois a fixture não inclui perdas e checkpoints representativos. A prova anterior de objetos/auditoria sintéticos está em [recuperação CIA](../reviews/cia-recovery-20261109-r2/README.md). R2 real mantém-se adiado.

O [piloto isolado](../reviews/baseline-pilot-20261109/results.json) concluiu três aberturas de Candidaturas e verificações de identidade e isolamento; a [limpeza](../reviews/baseline-pilot-20261109/cleanup.json) registou PASS. É uma prova do mecanismo, não uma baseline iniciada. Uma execução por dia não mede disponibilidade contínua e não valida, por si só, as restantes metas. Preparar separadamente um exercício de restauro com fronteiras de início e fim, dados representativos, auditoria, objetos e critério funcional; não afirmar aprovação de RPO/RTO com base no tempo técnico atual.
