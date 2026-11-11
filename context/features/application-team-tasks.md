# Candidaturas — equipa e tarefas (fatia 2)

## Calendário de prazos na ficha

Pedido de 10/11/2026. Adicionar um calendário opcional junto à lista de tarefas em «Equipa e tarefas». Usar a data de prazo como evento de dia inteiro, com título, responsável e estado. Mostrar mês navegável e agenda em largura reduzida. Usar as tarefas já carregadas e identificar resultados incompletos quando existe outra página. Uma tarefa aberta pode abrir o editor existente quando a edição está autorizada. Preservar os atalhos para tarefas, paginação, recuperação de pedidos e guardas do servidor.

Critérios de aceitação. Confirmar navegação entre meses, estado vazio, agenda móvel, abertura do editor por um gestor, consulta por um perfil sem edição e acesso ao Histórico a partir do Resumo. Validar build e testes do frontend.

Validação de 10/11/2026. O build e os 873 testes frontend passaram. Chrome em localhost:3000 confirmou que a equipa e o calendário abrem numa ficha existente com zero prazos em novembro. Com tarefas de teste, Chrome confirmou grelha a 1440 px, agenda a 390 px, mudança de mês, regresso a Hoje e abertura do editor com o prazo preenchido. O perfil de consulta viu as tarefas. A edição foi aberta apenas no perfil autorizado e a verificação decorreu em leitura.

Pedido de 11/11/2026. O botão «Calendário» abre um diálogo amplo, com a grelha mensal em computador e a agenda em ecrãs estreitos. O calendário usa o filtro de tarefas ativo. Ao fechar os detalhes ou o editor, deve voltar ao mês em consulta. Fechar o calendário pelo botão ou por Escape devolve o foco ao botão que o abriu.

Validação de 11/11/2026. Build e 944 testes do frontend aprovados. Em Chrome com API simulada, o diálogo mediu 1392 px num ecrã de 1440 px e mostrou a agenda a 390 e 320 px, sem deslocamento horizontal. Confirmados a navegação mensal, o regresso dos detalhes e do editor ao mês e à tarefa em consulta, e a reposição do foco ao fechar.

Estado: **Complete — fecho humano restrito (2026-10-17)**. Estados de tarefa confirmados pelo utilizador; aprovação humana explícita após revisão técnica GO e resolução do finding de apresentação do histórico.

Evolução autorizada em 18/10/2026: [acesso dos técnicos por equipa](application-technician-team-access.md). Para `CONTRIBUTOR`, a participação ativa passa a determinar leitura efetiva da candidatura e a limitar alterações previamente autorizadas; não cria grants persistidos nem acesso documental geral. As regras de tarefas, atribuições e histórico desta fatia são preservadas. As referências abaixo a ausência de acesso implícito descrevem o contrato original, anterior a esse incremento.

## Campos e comportamento

### Descrição e eliminação de tarefas

Pedido de 11/11/2026. As tarefas aceitam uma descrição opcional em texto simples, até 2000 caracteres. Quem pode criar ou editar uma tarefa pode preencher ou limpar a descrição. A lista, os detalhes do calendário e «O meu trabalho» mostram a descrição quando preenchida.

O Admin da entidade pode eliminar uma tarefa em qualquer estado, após confirmação. A eliminação retira a tarefa da lista, do calendário, de «O meu trabalho» e dos totais, preservando os dados e o evento «Tarefa eliminada» no histórico. O servidor exige perfil `ORG_ADMIN` e as guardas vigentes de edição na mesma candidatura.

Aceitação. Verificar criação sem descrição, gravação e remoção de texto, compatibilidade com tarefas e pedidos antigos, autorização em servidor, eliminação lógica, histórico, repetição idempotente e atualização das vistas.

Validação. A migração 038 passou a verificação do esquema em PostgreSQL descartável. Confirmados a preservação de uma tarefa antiga, a descrição e a sua limpeza, a recusa sem perfil de Admin, o isolamento entre entidades, a repetição idempotente, o histórico e a exclusão das vistas e totais ativos. Chrome com API simulada a 1440 e 390 px confirmou a descrição no calendário e o fluxo de confirmação. Build aprovado, 947 testes frontend aprovados e 2927 testes backend aprovados, com 7 ignorados.

Ambiente habitual. A migração 038 foi aplicada a 11/11/2026 após verificação da cópia do tenant. A Central publicou a revisão 9. As contagens e os hashes dos registos existentes de tarefas, trabalho, histórico e recibos coincidiram antes e depois. A sessão real do Admin Cliente recebeu as capacidades de descrição e eliminação na API de trabalho.

- Participante: referência a uma membership central da mesma organização, associação ativa ou removida. Remover desativa a associação e preserva o histórico; adicionar novamente reativa-a. A participação não cria grants nem acesso documental.
- Tarefa: identificador, título (1–200 caracteres), responsável (membership central ativa da organização), prazo obrigatório, estado, revisão e autor/datas. Atribuição não exige que o responsável seja participante. Uma membership revogada deixa de ser elegível para nova atribuição; a referência histórica e a tarefa permanecem, e um editor autorizado pode reatribuir uma tarefa aberta.
- Estados aprovados: `OPEN` → `COMPLETED` ou `CANCELLED`; terminais sem reabertura nesta fatia. Título, responsável e prazo editáveis enquanto `OPEN`. Conclusão/cancelamento não muda o estado da candidatura.
- Histórico append-only por candidatura, paginado e ordenado por revisão decrescente, com alteração, ator, data e valores resultantes. Tarefas terminais continuam visíveis.

## Permissões e integridade

- Leitura requer `application.read` e acesso à oportunidade associada; associação de avaliação F14, se houver, mantém a guarda da primeira fatia.
- Mutação requer `application.edit`, com as mesmas guardas cumulativas. A membership central vigente é a fonte de verdade para ator e responsável. Participante não obtém permissão implícita.
- Todas as mutações exigem revisão esperada, chave de idempotência e auditoria F7 atómica. Resultado incerto é reconciliado pelo recibo; reutilização divergente da chave é recusada. Tarefas eliminadas pelo Admin da entidade ficam arquivadas e os registos de histórico são imutáveis.

## Aceitação

- Interface permite gerir participantes e criar, atribuir, editar, concluir/cancelar e consultar tarefas e histórico no detalhe.
- Criação/edição recusam membership inválida, revogada ou de outra organização. Revogação de acesso, IDOR e isolamento A/B cobertos; concorrência, duplo envio e falha/recuperação sem duplicação ou sucesso falso.
- PostgreSQL local e browser demonstram o percurso; testes afetados e build passam.

## Exclusões

Documentos, aprovação interna, submissão externa, etapas configuráveis, tarefas automáticas, notificações, alertas e reporting. Esta fatia não fecha o pipeline integral nem altera o fecho humano da primeira fatia.

## Fecho restrito e evidência

Participantes usam memberships centrais válidas, sem grants implícitos. A interface e o backend permitem criar, atribuir, editar, concluir e cancelar tarefas; o histórico mostra autor, tarefa e valores resultantes. Concluir uma tarefa não altera automaticamente o estado da candidatura. O finding da apresentação do histórico foi resolvido.

[Evidência do incremento](../reviews/application-team-tasks/README.md): PostgreSQL/browser e suites anteriores cobrem o percurso e as garantias de autorização, isolamento, concorrência, idempotência e auditoria; a correção final da interface teve teste de componente 4/4 e build PASS. Essa correção não foi novamente validada no browser integrado. As provas são locais, com PostgreSQL descartável e IdP simulado; não cobrem staging, produção, IdP externo ou dados reais. O pipeline completo permanece por concluir.
