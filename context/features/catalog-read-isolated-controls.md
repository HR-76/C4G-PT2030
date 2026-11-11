# GCNI — controlos de exposição, reversão e monitorização isolados

Estado: Complete neste incremento isolado. Pedido autorizado em 01/11/2026. Usar exclusivamente infraestrutura de ensaio própria, fontes QUIESCED e nenhuma promoção habitual.

## Decisões do utilizador
Primeira disponibilização: perfil admin com membership válida. Continuar no computador local; o destino representativo não está escolhido. Recuperação, janela e canal de alertas ficam para depois. Não usar ou alterar a conta habitual; ensaiar com identidades sintéticas equivalentes.

## Critérios e plano de implementação
1. Composição controlada separada, desligada por omissão; organização e perfil provenientes exclusivamente da membership central. Operador local separado, sem rota administrativa HTTP.
2. Política versionada com comparação de versão, lease curta e estado indisponível a recusar acesso. Revalidar antes de devolver dados, incluindo pedidos em curso, mudanças de política e gerações retiradas com snapshots antigos.
3. Reversão de exposição: desligar o novo leitor sem apagar dados, alterar migrações, restaurar a base ou regressar ao binário incompatível. Sessões continuam no executável admitido046–048.
4. Interface isolada verifica disponibilidade, remove dados locais ao perder acesso e limita a validade da autorização visual. Não alterar a entrada habitual.
5. Monitorização sanitizada e limitada, métricas do catálogo existente, amostras exatas e avaliação de cobertura/latência/erros. Falha de recolha detetada; recuperação explícita. Persistência local de evidências no ensaio, sem contactos externos.
6. Testar off/admin/coorte/cliente fora da coorte, política expirada/indisponível, mudança durante leitura, retirada de geração, recuperação, CAS, cache/UI e ausência de segredos. Repetir OIDC/PostgreSQL e suites aplicáveis.
7. Separar mecanismo local demonstrado de operação distribuída, entrega externa de alertas, restauro e promoção habitual ainda pendentes. Autorrevisão e evidências finais.

Escolhas técnicas de ensaio: lease de política até5min, validade visual até30s, consulta de disponibilidade a cada15s; adaptador de política partilhado em memória dentro de um processo de teste, sem alegar persistência/distribuição produtiva. Perfis de ensaio limitados aORG_ADMIN eCONTRIBUTOR; o segundo só é aberto explicitamente na regressão sintética. O bloqueio de gerações não desaparece numa simples desativação/reativação.

## Resultado e autorrevisão — 01/11/2026

Incremento isolado concluído. Backend: 2455 testes aprovados, 7 ignorados, zero falhas (2462 no total). Frontend: 580 testes aprovados; builds habitual e controlado aprovados. PostgreSQL: 36 verificações aprovadas. OIDC/browser: 15 verificações aprovadas, incluindo admin primeiro, reversão com sessão preservada, retirada de gerações e falha/recuperação da monitorização. No final, exposição OFF, zero organizações admitidas; os dois contentores próprios foram removidos e o cluster PostgreSQL próprio foi encerrado.

Autorrevisão: autorização central por membership preservada; política revalidada antes da resposta; interface oculta imediatamente ao mudar de organização; operações de contenção continuam possíveis em falha de monitorização. Corrigidos durante a implementação o método HTTP registado, o limite de retenção das métricas e o bloqueio da abertura perante alertas. Testes finais repetidos após as correções. Sem alterações às migrações, manifesto habitual ou composição habitual. Veredicto: pronto para fechar este incremento isolado, não para promoção.

Limites explícitos: política em memória, partilhada apenas dentro de um processo; reinício começa OFF mas não conserva a lista de gerações retiradas. Antes de reabrir após reinício é necessária persistência validada. Não foi demonstrada coordenação entre processos. Reversão significa desligar a exposição no executável compatível com 046–048: não significa regressar ao binário antigo nem restaurar a base. A interface revalida a cada 15 segundos e expira a autorização visual em até 30 segundos; não pode recuperar dados já recebidos ou copiados. O endpoint de disponibilidade verifica autorização e controlos, não a saúde integral da base.

Evidências de monitorização entregues apenas num ficheiro local; não existe canal externo ativado. Amostras deste ensaio não certificam capacidade. O resultado de carga anterior não certifica a nova composição controlada. A federação institucional real continua pendente: OIDC foi ensaiado com Keycloak local e contas sintéticas. O perfil cliente foi aberto apenas para a regressão sintética; a primeira disponibilização pretendida continua admin.

Decisões: confirmado ensaio local e perfil admin. Ficam para uma etapa futura o computador/servidor onde ensaiar uma cópia representativa, a pessoa responsável por autorizar/interromper, a perda de dados e interrupção máximas aceitáveis, o horário de manutenção e o destino dos alertas. Nenhuma dessas escolhas foi presumida como autorização de promoção.

Próximo passo: guardar os controlos de forma duradoura e testar reinícios e coordenação entre instâncias no ambiente isolado, sem perder os bloqueios de versões retiradas.
