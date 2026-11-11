# Entrega 4 — comunicação administrativa na aplicação

Estado: Review, 2026-10-18. O utilizador autorizou preparar avisos, selecionar destinatários e consultar histórico dentro da organização. Email continua adiado.

## Evidência e contrato

O piloto conserva POST notifications/broadcast, com título, mensagem e filtro opcional ADMIN/PROFESSOR, que insere avisos globais BROADCAST. Não foi encontrado formulário de envio no frontend. Recuperar a capacidade com um formulário adaptado à organização; não apresentar um novo formulário como componente original preservado. Reutilizar os cartões Gerais da caixa de alertas.

Título e mensagem em texto simples; seleção explícita dos destinatários antes do envio, pré-visualização com organização, conteúdo e destinatários, confirmação e resultado. Nada pré-selecionado e nenhuma mensagem real de teste. Destinatários são memberships centrais ativas da organização atual. Não usar papéis UBI nem conceder acesso entre organizações ao administrador da plataforma.

Política confirmada pelo utilizador: apenas administradores da organização (ORG_ADMIN) preparam/enviam e consultam histórico administrativo; seleção individual de pessoas com opção de selecionar todos os membros ativos, sempre explícita. A permissão administrativa deve estar atribuída e o perfil atual deve ser ORG_ADMIN; FUNDING_MANAGER fica excluído mesmo com uma atribuição indevida da permissão.

Histórico administrativo imutável: conteúdo, autor, data, número de destinatários e detalhe dos destinatários escolhidos. Não expor ao autor se cada pessoa leu; não criar monitorização de leitura. Não editar nem apagar avisos enviados. Rascunho apenas no formulário; perde-se ao mudar de organização/conta. Após resposta incerta, conservar a mesma intenção para repetição segura e bloquear edição até resolver.

## Adaptação técnica

- Membership central continua a fonte de verdade. Permissão própria de leitura da caixa pessoal, independente de acesso às candidaturas; autorização de candidatura/oportunidade continua necessária para revelar os respetivos alertas. Permissão administrativa própria, cumulativa com o perfil confirmado, sem grants implícitos nos catálogos.
- Migração tenant 030 aditiva: aviso e destinatários imutáveis; leitura própria monotónica. RLS por organização e destinatário; histórico apenas sob autoridade administrativa atual.
- Nova autorização de caixa pessoal atribuída explicitamente às memberships da instalação local; autorização de envio apenas aos perfis confirmados. Preservar os grants existentes e a sua versão/histórico; aplicar sob o coordenador de autoridade e com backup. Não modificar automaticamente memberships de outras organizações.
- Envio transacional, F7 crítico, idempotência por organização/autor/intenção/digest; resultado repetido não duplica avisos. Limites técnicos: título 200 caracteres, mensagem 5000, até 1000 destinatários explícitos; histórico paginado de 25. Recusar excesso, corpo inesperado e destinatários inválidos, sem envio parcial.
- Conteúdo não vai para logs/F7; auditoria contém apenas identidades/referências e códigos. Sem email, scheduler, worker ou anexos nesta fatia. Convites, unidades ou scoring não são acrescentados.

## Apresentação

Identidade aprovada: branco #FFFFFF, fundo #F6F8F8, texto #20262B, navegação #075B59 e destaque #5FAD2F; tipografia de sistema. Alinhamento à esquerda. Alertas pessoais primeiro; acesso administrativo dentro da mesma página. Formulário de título/mensagem e destinatários, pré-visualização, ações claras, histórico tabular com detalhe. Sem novo dashboard nem decoração adicional. Adaptar a 390 px, preservando conteúdo e ações.

## Aceitação

1. Administrador autorizado prepara/revê/envia aviso; apenas memberships selecionadas na organização recebem um cartão Geral. O remetente só recebe se for explicitamente selecionado, como qualquer destinatário de uma comunicação geral.
2. Membro comum lê apenas os avisos destinados à sua membership; não consulta destinatários alheios/histórico administrativo e não envia. Administrador de plataforma sem autoridade organizacional não envia.
3. Revogação/perfil alterado/organização suspensa/contexto trocado impedem envio e leitura conforme a autoridade atual. Destinatário suspenso ou de outra organização invalida o envio todo. Novo membro não entra silenciosamente numa seleção já revista.
4. Repetição normal/COMMIT incerto/resposta perdida não duplica; chave reutilizada com conteúdo diferente é conflito. Falha F7 reverte aviso e destinatários; avisos enviados e leitura não podem ser apagados/revertidos pelo runtime.
5. Caixa e contador incluem avisos gerais sem exigir acesso às candidaturas; alertas de candidaturas continuam filtrados pela autorização do recurso. Troca de contexto descarta rascunho e respostas atrasadas.
6. Testes direcionados, build, sintaxe, PostgreSQL real A/B e Chrome desktop/móvel. Comparação honesta com os cartões do piloto e apresentação do formulário novo. Ativação habitual após provas e backup; validação local sem enviar mensagens reais a terceiros.

## Execução integrada — 18/10/2026

Após a confirmação das duas escolhas, foram ligados serviços, permissões, auditoria, caixa pessoal, formulário, revisão e histórico. Corrigida a recuperação do recibo em COMMIT incerto. 120 testes backend, 17 frontend, build, PostgreSQL real A/B e Chrome desktop/móvel PASS, incluindo a regressão dos alertas anteriores. Migração 030 aplicada localmente com backup protegido e duas concessões explícitas auditadas; dados/histórico/identidades/memberships preservados. Conferência OIDC habitual PASS nas duas contas, com dados intactos e sem mensagens reais de teste.

A prova inicial de fundação, com ports injetados, permanece como evidência da migração e da paginação; não substitui os gates integrados realizados depois. [Revisão e provas](../reviews/c4g-pilot-parity-delivery-4-communication.md), [comparação com o piloto](../../output/playwright/c4g-notices/comparison.html).

Próximo passo: rever a comparação com o utilizador na aplicação habitual.
