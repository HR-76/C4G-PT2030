# GCNI — plano de promoção controlada do catálogo

Versão 1.0 · 01/11/2026
Estado: Draft para execução; preparação documental concluída. Nenhuma promoção, migração, configuração, conta, fonte ou monitor foi ativado neste trabalho. Os passos abaixo são um procedimento proposto, não comandos executados nem funcionalidades já disponíveis.

## 1. Decisão e âmbito
Promover apenas a leitura do catálogo aprovado: barra de filtros, tabela, ficha e coleções, com membership central, snapshots e controlo de qualidade. Manter fontes QUIESCED, zero novas recolhas e bloqueio de publicação de conflitos materiais. A reativação de fontes exige um plano e autorização separados.

A aceitação isolada é a base técnica, não autorização para o ambiente habitual. A próxima implementação deverá preparar os mecanismos de operação e reversão e ensaiá-los num ambiente representativo. A execução habitual só pode começar com os bloqueios fechados e autorização explícita para a mudança concreta.

## 2. Evidência e lacunas verificadas
- Aceitação local: 2 443 testes backend aprovados, 7 ignorados, 576 frontend, build, 36 controlos PostgreSQL e 10 controlos OIDC/browser. Carga: 200 pedidos medidos e 40 aquecimentos sem erros; 10 000 oportunidades, 25 itens, 10 pedidos concorrentes, pools de 2 ligações.
- p95 agregado: lista 461,44 ms e ficha 396,15 ms. Pior série da lista: 495,72 ms perante alvo de 500 ms. Margem de 4,28 ms: repetir no destino representativo; não assumir capacidade produtiva nem aumentar limites para obter aprovação.
- OIDC local real com TLS/PKCE e identidades sintéticas de administrador/cliente. Ainda não certifica o fornecedor institucional, as contas, a MFA e a política do ambiente habitual.
- A interface depende atualmente do modo de compilação catalog-isolated. Não existe um interruptor operacional do catálogo novo comprovado para o ambiente habitual.
- O serviço de leitura é uma composição sem criação de pools nem montagem global. O percurso OIDC ensaiado monta-o através de uma ligação exclusiva do teste; isso não é uma integração habitual pronta.
- 046–048 continuam candidatos irreversíveis, com fingerprints e checksums fixos. O manifesto central habitual recusa-os. A capacidade isolatedAdmission está vinculada a uma base de ensaio; não deve ser reutilizada como atalho de produção.
- A observabilidade existente contém catálogos fechados, métricas HTTP/pool/autoridade e runbooks locais. Não foi comprovado um destino persistente de métricas, um dashboard ou entrega de alertas operacionais para este catálogo. A existência de instrumentos não comprova que este percurso os emita.
- A fixture geral do ensaio usa pg_read_all_data para algumas leituras centrais; não promover esse privilégio. Catálogo e membership já têm leitores dedicados limitados.
- O runbook staging-central-migration.md é histórico, limitado a 000–002 e PostgreSQL 17. Não é uma receita para aplicar 046–048. O código atual admite majors 17/18; a versão/distribuição concreta do destino continua a precisar de ensaio.

## 3. Condições que impedem executar agora
| ID | Condição de saída | Evidência exigida | Estado |
|---|---|---|---|
| P01 | Alvo, topologia e estado atual identificados | Ambiente/base/cluster, versão PostgreSQL, ledger, fingerprints e processos ligados; sem credenciais no documento | Pendente; não foi consultado o ambiente habitual |
| P02 | Responsáveis e janela definidos | Responsável da mudança, operador, responsável por dados/segurança e contacto de incidente; substitutos e janela | Pendente |
| P03 | Admissão habitual e retorno compatíveis | Artefactos revistos que admitem somente os estados completos aprovados antes/depois da mudança; testes de schema/ledger/ACL | Por implementar e ensaiar |
| P04 | Controlo de exposição completo | Composição normal, autorização no servidor, configuração desligada por omissão, coortes e desativação API/UI verificadas | Por implementar |
| P05 | Identidade institucional validada | Login real admin/cliente no IdP autorizado, membership, política/MFA, expiração e revogação; sem exceções de TLS | Pendente |
| P06 | Dados aprovados para leitura | Geração integral, evidências, prazos, montantes, documentos e conflitos revistos; nenhuma carga sintética em produção | Pendente |
| P07 | Recuperação operacional comprovada | Backup identificável e restauro numa cópia; RPO/RTO aprovados; ensaio da reversão aplicacional | Pendente |
| P08 | Monitorização efetiva | Instrumentação, recolha persistente, dashboard, destinatário e ensaio de alerta/recuperação | Por implementar/configurar |
| P09 | Capacidade e compatibilidade | Ensaio no destino representativo, frio/quente, mistura de filtros, recursos partilhados e restantes fluxos do GCNI | Pendente |
| P10 | Aprovação da mudança concreta | Artefactos com hashes, configuração sem segredos, matriz assinada e decisão explícita de executar | Não solicitada nesta fase |

Estes campos não são preenchidos por inferência a partir do computador local. RPO, RTO, retenção, janela e destinatários devem ser acordados antes de marcar a execução Ready. Não é necessário interromper a preparação documental para recolher essas decisões.

## 4. Componentes a preparar numa implementação posterior
| Componente | Alteração a preparar | Prova de aceitação |
|---|---|---|
| Manifestos, preflight e coordenador central | Registar o pacote no processo aprovado, com fingerprints exatos e estados completos permitidos; sem bypass nem reutilização da capacidade isolada | Recusar versão desconhecida, pacote parcial, checksum alterado, excesso de privilégios e deriva após lock |
| productionComposition e readRuntime | Montar o leitor depois da sessão GCNI; pools dedicados, identidade limitada, encerramento e readiness próprios | Sessão e outros fluxos GCNI funcionam antes/depois; faltas de dependência recusam leitura |
| CentralOpportunities e entrada habitual | Separar exposição do modo de build; configurar UI e API de forma coerente | URL direta também é recusada fora da coorte; esconder um menu nunca substitui autorização |
| Operação e configuração | Interruptor desligado por omissão e coortes estáveis de organizações autorizadas, administradas no servidor | Desativação efetiva e observável em todas as instâncias; membership continua obrigatória |
| Chaves de snapshot/cursor | Segredo próprio, estável entre réplicas, gerido pelo mecanismo do destino | Paginação entre réplicas; reinício/rotação com rejeição explícita dos tokens antigos, sem alteração do segredo de sessão OIDC |
| Dados e publicação | Preparar geração aprovada sem reativar recolhas; validar leitores/escritor/aprovador separados | Contagem, integridade e revisão sem conflitos materiais pendentes; histórico preservado |
| Telemetria | Adaptar instrumentos existentes e acrescentar apenas os estritamente necessários ao catálogo fechado | Medição realmente emitida, exportada e consultável; sem identificadores sensíveis ou cardinalidade ilimitada |
| Artefacto de retorno | Versão compatível com o esquema promovido, com o novo catálogo desligado e demais fluxos funcionais | Regresso ensaiado com as mesmas migrações ainda presentes e com sessões válidas |

Não inventar nomes de variáveis ou comandos de operação como se já existissem. A implementação posterior deve fixar os nomes, responsáveis, interfaces e testes antes de produzir um guião executável.

## 5. Sequência proposta e pontos de paragem
### Etapa A — fechar preparação
Identificar o destino e todos os processos que usam a Central, incluindo API e workers. Fixar artefactos imutáveis de promoção e retorno, respetivos hashes, configurações e compatibilidade. Identificar o estado anterior real; não presumir que é 045 nem migrar automaticamente até ele. Definir RPO/RTO, backup, responsáveis e canal. Saída: P01–P04 e desenho de P07/P08 fechados; fontes continuam suspensas.

### Etapa B — ensaio representativo, ainda fora do ambiente habitual
Usar uma cópia autorizada, minimizada e protegida, ou dados sintéticos representativos com as mesmas versões e topologia. Ensaiar migração, reinício, múltiplas réplicas, ativação/desativação, retorno, backup/restauro e indisponibilidade de telemetria. Testar também os outros percursos GCNI afetados pela admissão central. Validar o IdP autorizado de testes e as regras de sessão/MFA previstas para o destino.
Repetir cinco séries de dez pedidos concorrentes após aquecimento, lista e ficha, com 10 000 oportunidades, pools comparáveis e limites originais; todas as séries p95 <=500 ms e zero erros de aquecimento/medição. Medir separadamente arranque a frio, filtros diversos, várias organizações e sessões OIDC reais. Comparar com o habitual na mesma infraestrutura; degradação >10% dos percursos existentes exige análise e decisão antes de avançar. Os 7 testes ignorados têm de ser classificados quanto à relevância e executados onde aplicável, não contabilizados como sucesso.
Saída: P03–P09 demonstrados; nenhum gate em falta é convertido em aprovação tácita.

### Etapa C — autorização e preparação da janela habitual
Apresentar a matriz, o alvo exato, os hashes, as ações, a duração e os gatilhos de interrupção. Obter autorização explícita para essa mudança. Só depois executar a janela aprovada. Confirmar backup/restauro e capacidades da equipa; fixar baseline de sessões, latência, erros, filas e fontes. Suspender trabalhos incompatíveis conforme o plano aprovado; não parar indiscriminadamente o GCNI.

### Etapa D — migração e implantação com exposição desligada
Evitar versões antigas ligadas a um ledger que desconhecem: ou instalar primeiro uma versão de compatibilidade ensaiada que aceite exclusivamente ambos os estados completos, ou usar uma janela de manutenção aprovada. Não fazer rolling deployment misturando executáveis incompatíveis com o novo esquema. Aplicar o pacote uma única vez, pelo executor aprovado e identidade de migração, com lock, ledger e verificações finais. Não utilizar o harness de ensaio como instalador habitual.
Colocar a versão promovida e o artefacto de retorno compatível sob controlo; manter o catálogo novo sem exposição. Verificar sessões, organização, health, autorizações e fluxos essenciais existentes. Se a migração falhar: observar o estado real antes de qualquer nova tentativa; não inferir rollback nem reaplicar às cegas.

### Etapa E — coortes controladas
Proposta de cadência a aprovar: primeiro administradores designados com membership durante pelo menos 30 minutos; depois uma organização cliente consentida durante um dia útil; só depois alargar a organizações explicitamente selecionadas. Cada transição é uma decisão humana documentada, não consequência automática do tempo decorrido. Para baixo tráfego, cumprir os percursos de teste em vez de afirmar estabilidade a partir de ausência de pedidos. Manter fontes suspensas em todas as coortes.

### Etapa F — estabilização e encerramento
Proposta: observação reforçada durante dois dias úteis após o alargamento autorizado, incluindo um período de utilização relevante. Confirmar métricas, privacidade, documentos, qualidade, permissões e incidentes. Arquivar decisão, artefactos, evidências e contactos. A promoção do leitor não autoriza conectores, jobs, novas publicações ou fontes.

## 6. Reversão sem perda de evidências
| Situação | Ação proposta | Critério de recuperação |
|---|---|---|
| Antes de aplicar migrações | Abortar a janela; manter a versão e configuração habituais | Baseline e sessões inalteradas; nenhum write parcial |
| Pacote aplicado, exposição desligada | Manter o esquema aditivo e o artefacto compatível; não iniciar coortes | Sessões e restantes fluxos saudáveis; leitor novo fechado |
| Falha funcional/performance do catálogo | Suspender imediatamente novos acessos ao catálogo no servidor e UI; drenar/cancelar em curso conforme mecanismo ensaiado | Nenhum acesso novo indevido; outros fluxos funcionam; motivos comunicados sem dados sensíveis |
| Necessidade de regressar ao comportamento anterior | Usar o artefacto de retorno previamente ensaiado que admite o esquema já aplicado | Login, seleção de organização, autorização e comportamento anterior comprovados no esquema pós-migração |
| Geração incorreta | Impedir novas leituras afetadas; avaliar uma geração anterior apenas se a aprovação ainda for válida e não revogada | Gate de publicação/ativação aprovado; sem apagar ou reescrever versões |
| Compromisso de acesso ou integridade | Isolar o percurso afetado, preservar evidências e acionar responsável de segurança | Nenhuma exposição adicional; recuperação formalmente validada |
| Dano que exija recuperar a base | Processo excecional de recuperação, com paragem coordenada, backup/PITR ensaiado e aprovação específica | RPO/RTO demonstrados, reconciliação de todas as escritas desde o ponto de recuperação |

Não executar down migrations de 046–048, apagar ledger, eliminar evidências ou restaurar automaticamente toda a Central para resolver uma falha visual. As migrações estão marcadas como irreversíveis. Um restore integral pode perder sessões e escritas de outros módulos; não é a reversão normal deste leitor.

Mudar a geração ativa não invalida snapshots antigos: estes ficam vinculados à geração original por até 15 minutos. Se houver conteúdo que não possa continuar acessível, o mecanismo de contenção deve bloquear também a geração afetada ou desativar o percurso, com resposta explícita e teste. Esperar pela expiração não serve como contenção de uma exposição de dados. Não reutilizar snapshots entre organizações; não fazer fallback silencioso para contornar revogação, conflitos ou admissão recusada. Um modo de retorno não pode reabrir dados retirados pelo controlo de qualidade.

## 7. Monitorização proposta
Os limiares seguintes são critérios de operação propostos para aprovação e ensaio, não alertas já instalados nem SLA contratado. Recolher histogramas e contadores por modelo de rota, resultado e componente; medir também tempos absolutos dos probes. Agregar histogramas corretamente, sem calcular a média de p95 entre processos.

| Sinal | Limiar/cadência propostos | Ação |
|---|---|---|
| Violação entre organizações, dados após revogação ou alteração de integridade | Uma ocorrência confirmada | Contenção imediata no servidor; interromper alargamento e acionar segurança |
| Ledger, schema, ACL ou identidade técnica incompatível | Uma deteção confirmada | Recusar acesso e parar a mudança; nunca executar migrações automaticamente para recuperar |
| Fonte reativada ou novo funding run não autorizado | Uma ocorrência | Interromper promoção, conter o executor e investigar; não apagar histórico |
| Disponibilidade | Probe autenticado de baixa frequência: 1/min por percurso e papel, coordenado entre réplicas; 3 falhas consecutivas | Parar avanço e diagnosticar; reverter exposição se regressão atribuível à mudança |
| Latência de lista/ficha | p95 >500 ms em duas janelas de 5 min, cada uma com >=100 pedidos válidos; aviso a partir de 450 ms | Congelar alargamento; comparar pool, SQL, CPU, memória e baseline; reverter se persistir após diagnóstico curto de 10 min |
| Erros não esperados | >1% de 5xx em 5 min com >=100 pedidos, ou 3 falhas consecutivas de probe | Interromper coorte; conter/reverter se confirmado |
| Baixo tráfego | Menos de 100 pedidos/janela | Não concluir cumprimento de p95; usar probes e ensaio controlado autorizado, sem gerar carga produtiva implicitamente |
| Sessão/membership/snapshot | Separar401/403/409/410 esperados de recusas indevidas | Denegação esperada não é incidente; autorização indevida tem tolerância zero; subida de recusas legítimas exige diagnóstico |
| Pools e memória | Espera p95 >100 ms ou fila persistente >60 s; qualquer timeout de ligação; tendência de heap/RSS e cache | Congelar alargamento e investigar; não aumentar pools/limites sem novo ensaio |
| Cold start/cache | Medir primeira leitura, duração da construção, coalescência, entradas/bytes e falhas | Demonstrar ausência de recusas no arranque; vigiar tempestades de reconstrução e após reinício |
| Telemetria | Ausência de sinal por >2 min durante uma coorte, exportação falhada ou descarte | Parar avanço; não declarar sucesso num período sem observação |
| Qualidade/publicação | Geração visível, contagem, estado de revisão e integridade | Avisar revisão pendente; nunca publicar conflitos materiais automaticamente |

500 ms tem de ser observado com resolução adequada: o histograma HTTP existente tem um bucket de 0,5 s, mas isso não fornece por si só um p95 exato de495 ms. Acrescentar resolução ou amostras controladas sanitizadas e validar o cálculo. O limite de 64 MiB contabiliza dados da cache/leituras; não é um limite exato do heap do processo. Definir o orçamento real de RSS/heap na infraestrutura identificada.

Reutilizar c4g.http.server.duration, c4g.db.pool.wait, c4g.authorization.decision, health e telemetry.drop onde efetivamente emitidos. A instrumentação adicional deve passar pelos catálogos e limites de cardinalidade existentes. Não colocar UUIDs, títulos, utilizadores, emails, cookies, tokens, snapshots, cursores, URLs de ligação ou queries livres em métricas. Diagnóstico autorizado pode correlacionar requestId/release/generation de forma restrita; nunca imprimir segredos. Destino, retenção, acesso, contacto e entrega de alertas têm de ser preenchidos e testados em P08.

## 8. Matriz de aceitação da futura promoção
| ID | Ensaio/evidência | Resultado requerido |
|---|---|---|
| A01 | Hashes de promoção e retorno, alvo e estado anterior | Inventário inequívoco e aprovado |
| A02 | Migração/replay/falha e preflight | Ledger e fingerprints exatos; sem estado parcial admitido ou histórico reescrito |
| A03 | Outros fluxos e sessões GCNI antes/depois/retorno | Compatibilidade comprovada em todas as instâncias e workers relevantes |
| A04 | Login admin e cliente no IdP autorizado | Política e TLS íntegros; membership obrigatória; sem privilégios de fixture |
| A05 | Tabela/ficha/filtros/coleções/qualidade | Correspondência com geração aprovada, precisão financeira e temporal |
| A06 | Isolamento, revogação durante leitura e rota direta fora da coorte | Nenhuma resposta de dados após perda de acesso |
| A07 | Snapshot 15 min, cursor, réplicas e reinício | Continuidade ou erro explícito previsto; nunca reutilização entre scopes |
| A08 | Frio/quente, 10 000 registos e perfis mistos | Zero erros nos gates; p95 contratado; impacto dos outros fluxos avaliado |
| A09 | Desativação, rollback compatível e geração retirada | Contenção efetiva em todas as instâncias, sem fuga por snapshot antigo ou fallback |
| A10 | Backup restaurado numa cópia e ensaio de recuperação | RPO/RTO aprovados e comprovados; sem restore destrutivo no habitual |
| A11 | Métricas/alerta/entrega/recuperação e perda de telemetria | Observação operacional efetiva, sem segredos e sem avanço às cegas |
| A12 | Fontes e histórico antes/depois | QUIESCED, zero recolhas novas e conflitos materiais bloqueados |

Registo por gate: responsável, instante UTC, artefacto/hash, ambiente, evidência, resultado, desvio e decisão. Pendente não significa PASS. Todos os gates aplicáveis devem passar antes de autorizar alargamento.

## 9. Autorrevisão deste plano
Veredicto: plano documental preparado; execução ainda não pronta. A revisão identificou e tratou quatro riscos principais: retorno binário incompatível com as migrações; exposição apenas pelo frontend; snapshots antigos ainda acessíveis após trocar a geração; e monitorização apenas local confundida com alertas operacionais. A margem reduzida de latência continua explícita.
Não foram criados switches, dashboards, alertas, jobs, credenciais ou scripts de promoção. Não foram executados testes de infraestrutura neste incremento documental. As evidências de testes referidas são as da aceitação anterior; esta revisão verificou a coerência do plano com código, manifestos e runbooks locais.

## 10. Referências locais verificadas
- context/features/catalog-read-acceptance-load.md — resultado e limites da aceitação.
- frontend/src/pages/Opportunities/CentralOpportunities.jsx — condição catalog-isolated.
- backend/src/productionComposition.js — composição habitual e capacidade isolada opcional.
- backend/src/opportunities/catalogRead/readRuntime.js — composição pura do leitor.
- backend/src/opportunities/catalogRead/isolatedAdmission.js e readPackage.schema.json — admissão isolada e pacote 046–048.
- backend/src/security/centralMigrationPreflight.js e postgresCatalogCompatibility.js — admissão habitual e versões suportadas.
- backend/src/observability/metrics.js, catalogs.js, exporters.js — instrumentos/catálogos e exportador em memória disponível.
- context/runbooks/observability/README.md e schema-incompatible.md — alcance local e recusa de migração automática.
- context/runbooks/staging-central-migration.md — referência histórica; não aplicável como procedimento 046–048.

Próximo passo: preparar e ensaiar, ainda em ambiente isolado, os mecanismos de exposição controlada, admissão habitual compatível, retorno e telemetria definidos neste plano, após fechar as decisões operacionais necessárias.
