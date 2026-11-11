# GCNI — persistência dos controlos e reinícios isolados

Estado: Complete neste incremento isolado. Âmbito autorizado: ensaio local sintético, sem fontes, promoção ou alterações ao manifesto habitual.

## Critérios de aceitação
1. Adaptador PostgreSQL explícito, separado do catálogo e do runtime habitual; SQL apenas no pacote de ensaio, fora das migrações ativas.
2. Estado inicial OFF, versão monotónica, comparação e troca atómica, bloqueios de gerações apenas acumuláveis e histórico na mesma transação.
3. Credenciais dedicadas: leitor não escreve, operador só executa a função de transição; sem privilégios administrativos. Sem cópia em cache nem leitura de réplica assíncrona.
4. Instância nova começa localmente fechada, mesmo que a política persistida esteja aberta. Reentrada explícita exige versão atual e monitorização saudável. Lease até cinco minutos; o relógio da base também impõe expiração.
5. Dois processos independentes observam as alterações; uma corrida tem um só vencedor; pedidos preparados antes da mudança não libertam dados.
6. Reinício de processo e da base conserva estado, histórico e bloqueios. Reabertura continua a recusar gerações retiradas. Falha de ligação, permissões ou estado ausente impede leitura e não reinicializa a política.
7. Verificar sintaxe, testes focados, suite backend e gate PostgreSQL real com limpeza dos recursos próprios. Não repetir nem alegar carga/IdP produtivos.

Escolha técnica limitada ao ensaio: PostgreSQL já utilizado pelo GCNI, esquema exclusivo gcni_catalog_control_rehearsal, sem alteração da topologia produtiva. A reentrada de uma instância não modifica a política global. Não existe eleição automática, abertura automática ou rota HTTP de operação.

Próximo passo: implementar e verificar estes critérios no ambiente isolado.

## Resultado e autorrevisão — 01/11/2026

Incremento de persistência concluído em ambiente isolado. Estado global da melhoria: In Progress; promoção habitual continua pendente.

Adaptador PostgreSQL sem inicialização automática, com leitor e operador separados, transição atómica por versão e histórico na mesma transação. Bloqueios de gerações não podem ser removidos pela função de operação. Instâncias novas começam fechadas e requerem admissão explícita à versão atual com monitorização saudável. A reentrada local não altera a política global. A expiração é verificada também pelo relógio da base; continuam possíveis operações de contenção depois da expiração.

Validação: backend 2460 PASS / 7 SKIP / 0 FAIL; frontend 580 PASS e build PASS; sintaxe JavaScript/PowerShell PASS; 16 verificações PostgreSQL reais PASS. Dois processos Node independentes partilham a política. Demonstrados: um vencedor numa corrida de escrita, revogação durante resposta preparada, reinício de processo e base, recusa de snapshots retirados, separação de permissões, recusa após revogação de permissões, ausência de reinicialização perante estado ausente, rollback integral quando o histórico falha e versões históricas contíguas. Estado final OFF, zero organizações admitidas; contentor próprio removido.

Autorrevisão: corrigida e repetida a regressão de precedência dos operadores JSON na proteção contra remoção de bloqueios. Acrescentadas verificações de erros de ligação sanitizados, admissão monitorizada e contenção com política expirada. Nenhuma falha pendente identificada nos critérios deste incremento. Veredicto: ready to close para este incremento isolado. Os sete testes ignorados não são contabilizados como aprovações. As primeiras execuções das suites em contexto restrito não constituem evidência de aprovação: frontend não arrancou por falta de escrita temporária, backend apresentou falhas e foi interrompido; as repetições com permissões locais adequadas terminaram com sucesso.

Limites: foi ensaiado um primário PostgreSQL local, não failover/HA, restauro de backups, réplica distribuída ou infraestrutura habitual. Os processos de teste usam autoridade e catálogo sintéticos; este gate não renova a certificação OIDC institucional nem a carga. O ensaio OIDC anterior permanece uma evidência separada do adaptador em memória. Não existe ativação no runtime habitual, endpoint HTTP de operação, alerta externo ou fonte reativada. Um processo que continua vivo após interrupção da base volta a consultar a mesma política persistida; só um processo novo exige nova admissão local. Uma reposição de backup antigo requer procedimento próprio para evitar regressão de versões e de bloqueios; não está aprovada por este ensaio. Os pools devem ser dedicados, limitados e com tempos máximos de ligação/consulta, como no harness.

Decisões preservadas: admin primeiro; continuar localmente. Escolha de servidor/cópia representativa e responsável, recuperação, janela e canal de alertas ficam para etapa futura. Nenhuma decisão adiada foi presumida.

Próximo passo: integrar o adaptador durável no ensaio OIDC isolado e repetir a aceitação funcional e a carga da tabela/ficha, antes de preparar qualquer promoção.
