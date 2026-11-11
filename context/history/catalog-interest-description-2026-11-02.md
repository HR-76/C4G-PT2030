# Catálogo unificado — interesse e descrição

Pedido: disponibilizar o registo de interesse e a descrição da call no GCNI.

## Comportamento

- Tabela e ficha reutilizam o formulário de interesses da organização, com seleção opcional de unidades, recibo idempotente e ligação ao interesse existente.
- Antes de abrir o formulário, a consulta unificada é novamente autorizada e a revisão apresentada é comparada com a revisão central atual. Uma divergência interrompe a preparação; o servidor continua a verificar a revisão e a autorização ao guardar.
- O regresso do interesse mantém a rota da ficha unificada e os filtros.
- A ficha mostra a descrição EU integral conservada na evidência já importada. A correspondência exige digest da revisão e hash/localizador da evidência. Texto renderizado como texto, nunca HTML. Não há recolhas nem alterações aos snapshots históricos.
- A tabela conserva apenas excertos úteis. Um título repetido deixa de ocupar a área de descrição. Quando não há descrição detalhada disponível, a ficha indica essa limitação; não se inventa conteúdo Portugal 2030.

## Validação e autorrevisão

- Backend: 2 539 testes passaram; sete ignorados pela suite existente; zero falhas.
- Interface: suite completa final com 596 testes passou, incluindo permissão ausente, descrição indisponível e ausência de pedidos privados antes de haver dados.
- Build de produção e verificação de sintaxe concluídos.
- Testes novos cobrem identidade/revisão, acesso recusado, interesse existente, retorno seguro, integridade das evidências, preservação das projeções e revogação antes de devolver a descrição.
- A primeira tentativa ponta a ponta não concluiu a ação; o administrador sintético não tinha permissões de interesses. O administrador habitual já possuía read/register/manage, confirmado apenas em leitura. A fixture foi alinhada explicitamente, sem mudanças às permissões reais. Uma tentativa de diagnóstico encontrou também uma espera de paginação do ensaio; uma execução foi interrompida antes da autenticação para corrigir o encaminhamento da ficha no servidor de testes. Os resultados falhados são preservados.
- Fontes, duração da exposição e regras de membership mantidas. Sem DDL, novos conectores ou criação automática de interesses no ambiente habitual.

Ensaio ponta a ponta PASS: 22 verificações em `../reviews/catalog-read-acceptance-load/8f3b1091d456496a978c596e7d579c21/results.json`. Criação pela interface, persistência após recarregar, fontes QUIESCED, ausência de duplicação após reinício, deriva de permissões recusada e revogação do administrador confirmadas. Contentores descartáveis removidos.

A aceitação encontrou e corrigiu esperas nas leituras de interesses: agora os eventos observacionais autorizados usam o mecanismo existente de finalização de auditoria, seguido das mesmas verificações físicas, de membership e do guard antes do commit. Recusas e eventos críticos continuam imediatos; escritas não usam esta política. Regressão falhou antes da inclusão da política; 21 testes focados e a suite completa passaram depois. Não se omitem eventos nem se reutilizam decisões entre pedidos.

Autorrevisão: sem problemas impeditivos no âmbito alterado após correções; criação privada confirmada apenas nas contas sintéticas. Aplicação habitual com backup e verificação de integridade, sem alteração de dados, permissões ou fontes.

Limite: a navegação com a conta humana habitual não substitui o ensaio isolado e deve ser confirmada pelo administrador; não foram usadas nem solicitadas palavras-passe.


Fecho: aplicado ao GCNI habitual em 2026-11-02. Ensaio adicional com tenant 034 PASS (23 verificações): `../reviews/catalog-read-acceptance-load/3e2341fd708e4f428ea49e50b8463764/results.json`; confirmado um interesse privado, um evento de registo e eventos de autorização preservados. Verificação habitual: schema 048, 178 oportunidades/178 revisões, geração inalterada, fontes QUIESCED, zero recolhas, interface e saúde 200, catálogo anónimo 401. Janela controlada de cinco minutos e acesso inicial ao administrador da entidade mantidos. Backup dos ficheiros anteriores preservado em `.tmp/catalog-interest-description-*`.
