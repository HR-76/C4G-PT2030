# Utilizadores internos e registo de parceiros por candidatura

Estado: **Draft — âmbito simplificado por decisão do utilizador, 18/10/2026**. Este documento substitui o plano de convidados externos anteriormente registado neste mesmo caminho. Não constitui implementação ou nova validação do runtime.

Incremento interno autorizado e em **Review**, implementado/validado localmente: [técnicos com acesso por equipa](application-technician-team-access.md). A evidência da implementação abaixo descreve a situação anterior à correção; consultar esse contrato para estado e validação atuais. A atribuição/gestão de perfis no ecrã Acessos está implementada e validada localmente, em Review, no [contrato específico](organization-internal-access-profiles.md). O utilizador confirmou que o gestor da entidade também deve poder atribuir acessos à equipa; o âmbito simples permite gerir técnicos, reservando a atribuição de Administrador/Gestor ao administrador.

## Decisão vigente

Nesta fase, parceiros são entidades e pessoas registadas na candidatura para conhecimento e acompanhamento pelo gestor. Mantém-se o registo já recuperado na entrega 3, sem criar um sistema de colaboração externa.

- Registar e atualizar a entidade parceira, os seus dados, responsável e contactos.
- Associar pessoas e respetiva informação à ficha do parceiro na candidatura.
- Consultar essa informação dentro do acesso autorizado à candidatura.
- Preservar identificadores, relações e histórico; retirar associações logicamente.
- O registo de um parceiro ou contacto não cria conta, membership ou permissões.

**Fora do âmbito desta fase:** convites a parceiros, login externo por candidatura, informação partilhada com convidados e tarefas executadas por parceiros na aplicação. Estas funcionalidades foram retiradas do plano ativo; não são uma pendência obrigatória para concluir a recuperação. Uma eventual retoma exige novo pedido.

## Regras internas preservadas

- A C4G gere plataforma, APIs/fontes e catálogo central. A administração da plataforma não concede acesso privado automático às candidaturas dos clientes; mantém-se o suporte explícito e auditado.
- Todas as entidades consultam o catálogo central. Candidaturas e respetivos dados privados pertencem à entidade titular.
- Técnicos veem apenas candidaturas em cuja equipa participam. A pertença ao departamento não abre as restantes candidaturas.
- Identidade global e membership central continuam a ser a fonte de autoridade; preservar dados, histórico e isolamento.
- O detalhe vigente dos perfis internos está no [contrato de Acessos](organization-internal-access-profiles.md), incluindo a confirmação posterior de que o gestor da entidade gere os acessos da equipa. A simplificação dos parceiros não introduz acesso externo.

## Percurso de parceiros a conservar

1. O gestor/editor autorizado abre a candidatura e a secção de parceiros.
2. Insere a entidade, país, área/interesse, responsável, contacto e email.
3. Acrescenta as pessoas associadas, com nome, função, área e contactos.
4. Guarda e consulta a informação; pode corrigir a ficha ou retirar uma associação, preservando o histórico.

São os campos e o comportamento já documentados no [contrato de parceiros por candidatura](../references/application-partners-http.md). Não se pede um novo módulo, um catálogo global de contactos nem novas configurações.

## Evidência da implementação atual

- `backend/src/applications/partners.js` e o contrato HTTP descrevem parceiros e pessoas como contactos privados da candidatura, sem criação de contas ou acessos. A entrega 3 já recuperou esse percurso.
- `frontend/src/pages/Organization/OrganizationAccess.jsx` e `backend/src/organizationDirectory/membershipAccess.js` disponibilizam consulta, suspensão e reativação dos acessos existentes.
- `backend/src/applications/work.js`: adicionar um participante não cria grants. A atribuição de tarefa a membro ativo pode ocorrer sem participação na equipa. A regra pretendida para técnicos ainda requer análise/ajuste coordenado de autorização.
- `backend/src/applications/repository.js` e `browse.js`: as listas e detalhes têm guardas de candidatura, oportunidade e, quando aplicável, avaliação. Não basta ocultar itens no menu para aplicar o âmbito dos técnicos.

A evidência é documental e de leitura de código; não foi repetida nesta alteração uma validação funcional no browser.

## Plano limitado ao âmbito atual

1. Conservar o percurso existente de inserção/consulta de parceiros e pessoas; verificar a apresentação na revisão global da aplicação e corrigir apenas diferenças concretas encontradas.
2. Retomar a análise dos acessos internos C4G/entidade/gestor/técnico, fechando as ações antes de implementar alterações. Não incluir convidados externos, convites ou concessões a contactos.
3. Validar os perfis internos com duas organizações, candidaturas e equipas distintas, incluindo listas, detalhe, indicadores, exportação e revogação. Preservar o trabalho da entrega 5.

Não há migração, novo serviço ou alteração de permissões necessária apenas para retirar a colaboração externa deste plano.

## Critérios de aceitação

| Critério | Verificação |
| --- | --- |
| Gestor autorizado insere, consulta e atualiza parceiros e pessoas na candidatura | Percurso existente de criação/edição/releitura; revisão visual na aplicação |
| Contactos não recebem contas ou acesso por serem registados | Contrato/serviço de parceiros e ausência de concessões automáticas |
| Parceiros, pessoas e histórico permanecem privados da candidatura e entidade autorizadas | Testes direcionados de parceiros e isolamento entre organizações quando houver alteração de código |
| Retirar uma associação preserva dados históricos | Revisão do histórico e testes de remoção lógica existentes |
| Técnicos ficam limitados às candidaturas da sua equipa | Critério interno a demonstrar antes de concluir a revisão de acessos; não declarado implementado por este documento |

## Histórico da decisão e limites

Inicialmente foi considerado e confirmado acesso de parceiros por convite, limitado a informação partilhada e tarefas próprias, com convites por administrador/gestor. **A instrução posterior do utilizador retirou essa colaboração externa do âmbito desta fase**, mantendo apenas a inserção de parceiros e informação para o gestor. Os anteriores critérios de convites e partilha deixaram de ser requisitos ativos.

Esta atualização altera apenas documentação. A entrega 5 global mantém-se em curso; Dashboard/relatório continua em Review. Armazenamento, antivírus e email mantêm-se para o final, sem novas dependências introduzidas por parceiros.
