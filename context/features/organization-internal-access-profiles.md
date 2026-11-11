# Perfis internos no ecrã Acessos

Estado: **Review — implementado, validado e ativo localmente em 18/10/2026, 16:09 (Lisboa)**. O utilizador confirmou que o gestor da entidade também deve atribuir acessos à sua equipa. Implementação autorizada com esse ajuste.

## Âmbito

Gerir os perfis das memberships existentes da organização ativa no ecrã Acessos, mantendo suspensão e reativação. Três opções fixas: administrador da entidade, gestor de candidaturas e técnico. Sem editor genérico de permissões, convites, criação de contas externas ou mudanças à administração C4G. Parceiros continuam contactos informativos da candidatura.

Matriz vigente:

- Administrador: gestão da entidade, acessos e candidaturas.
- Gestor: gestão de todas as candidaturas e dos acessos dos técnicos da entidade; atribui Técnico a membros existentes de Consulta e suspende/reativa técnicos. Um acesso de Consulta legado é convertido explicitamente para Técnico antes de poder ser reativado pelo gestor. Não promove administradores/gestores nem altera essas contas.
- Técnico: consulta das candidaturas da sua equipa, mantendo eventuais permissões de trabalho já atribuídas; participação não atribui escrita automaticamente.
- Catálogo central disponível a todos; nenhuma atribuição concede acesso a outra entidade.

A atribuição de Administrador/Gestor fica reservada ao administrador. O perfil legado `VIEWER` não será convertido automaticamente. Não se alteram o próprio perfil ou estado: outro administrador efetua a mudança, impedindo a perda do último administrador ativo. A participação do técnico na candidatura continua a ser gerida na equipa da candidatura.

## Evidência anterior à implementação

- `OrganizationAccess.jsx` apresenta nome, email e estado, com suspensão/reativação; falta o perfil.
- `membershipAccess.js` altera apenas estado, com revisão otimista, repetição idempotente, auditoria central e coordenação da autoridade.
- Os perfis estruturais não conferem permissões automaticamente: o catálogo de perfis tem listas vazias e as concessões explícitas residem em `authority_f5_state`.
- O endpoint de alteração verifica a permissão `organization_membership.manage`; ainda não exige explicitamente `ORG_ADMIN` nem protege o último administrador.
- A listagem de memberships está autorizada por `organization_directory.edit`, também usada pela associação entre pessoa e conta. Não retirar essa associação inadvertidamente ao ajustar o ecrã Acessos.
- A restrição de técnicos por equipa já está implementada e validada no incremento [anterior](application-technician-team-access.md).

## Implementação

1. Definir uma matriz fechada de permissões para os três perfis, reutilizando os contratos atuais. Explicitar a substituição das permissões geridas pelo perfil e a preservação das concessões específicas compatíveis, para que um rebaixamento não conserve poderes administrativos.
2. Expor perfil atual e capacidades de gestão; acrescentar comando HTTP de alteração com organização resolvida pelo servidor, revisão, idempotência e autorização atual de administrador/gestor limitada ao alvo.
3. Atualizar perfil e permissões atomicamente na base central, com auditoria e incremento das versões de autoridade. Usar migração aditiva e queries admitidas pelo protocolo central; não reescrever migrações aplicadas.
4. Impedir que a organização fique sem administrador ativo; preservar conta, pessoa, relações, tarefas, outras memberships e histórico. Revalidar autorização em cada pedido.
5. Recuperar o percurso na tabela Acessos com perfil legível, opções fixas, explicação do efeito, confirmação da alteração, erros úteis e repetição do mesmo envio se a resposta for incerta.
6. Validar em PostgreSQL descartável, HTTP e browser antes de ativar localmente; não alterar perfis reais como ensaio.

## Critérios de aceitação

| Critério | Prova exigida |
| --- | --- |
| Administrador atribui um dos três perfis a uma membership existente da entidade | Guardar e reler no browser e na API |
| Técnico não gere acessos; gestor só gere técnicos/consulta, mesmo com concessões administrativas antigas | Pedidos diretos recusados |
| Alteração não atravessa organizações; A e B usam identidades distintas e uma segunda membership não removida é recusada | Teste A/B de leitura e escrita e teste do vínculo único |
| Perfil e permissões mudam em conjunto ou não mudam | Rollback de auditoria e falha transacional |
| Repetição não duplica a alteração e versões concorrentes não se sobrepõem | Idempotência, conflito e concorrência |
| Último administrador ativo fica protegido | Rebaixamento/suspensão recusados, incluindo concorrência |
| Técnicos permanecem limitados à equipa e tarefas/histórico são preservados | Regressão da autorização por equipa |
| Alteração/revogação é respeitada por sessões existentes | Pedidos seguintes revalidados |
| Nenhuma migração automática de pessoas, contas ou perfis legados | Conferência dos dados antes/depois |
| Interface utilizável no desktop e móvel | Browser, build frontend e testes direcionados |

Armazenamento, antivírus e email permanecem adiados. A entrega 5 global não fica concluída por este incremento.

As permissões gerais são substituídas pelas do perfil escolhido apenas mediante comando explícito. Conservam-se concessões específicas de trabalho em candidaturas/documentos; privilégios gerais de um administrador/gestor não transitam para Técnico. Nenhuma membership real será convertida como parte da instalação. A listagem administrativa usa endpoint próprio para preservar a associação pessoa/conta já existente.

## Decisões de implementação

- `GET /api/organization-directory/access` serve a tabela; a listagem anterior de memberships continua disponível ao diretório para associação pessoa/conta.
- `PUT /api/organization-directory/memberships/:id/profile` recebe apenas `profileCode`, `expectedRevision`, `idempotencyKey`. O endpoint de estado mantém o contrato anterior.
- A membership central determina a capacidade de gerir acessos: Administrador/Gestor recebem a permissão de gestão exclusivamente dentro deste serviço, com autenticação recente e auditoria existentes. O Gestor tem restrições adicionais sobre o alvo. Não se expandem os catálogos globais de perfis nem concessões persistidas durante leituras.
- Alterar perfil substitui concessões gerais pelos conjuntos fixos. Preserva concessões específicas de leitura/edição/transição/revisão de candidaturas e de leitura/upload/download documental; poderes gerais de gestão não transitam para Técnico. Os grants de trabalho anteriores de um Técnico são conservados. Não são concedidas novas permissões documentais.
- Alteração do próprio acesso recusada; mudanças entre administradores passam pela mesma coordenação da organização, revalidando o ator antes da escrita. Assim, duas mudanças concorrentes não podem retirar ambos os administradores.
- Migração central aditiva 019 regista duas queries fechadas (listagem e alteração de perfil) no protocolo de autoridade. Sem tabelas novas, migrações tenant ou conversão de memberships. O perfil, concessões, versões e evento GRANT_CHANGED são transacionais. A auditoria regista os perfis anterior/novo e versões.
- `AUTHORITY_WRITE_PENDING` é conflito HTTP 409: atualizar e rever; nenhuma proteção é contornada.

## Validação final

85 testes backend e 10 frontend PASS; build/sintaxe e diff check PASS. A prova histórica PostgreSQL A/B confirmou limites do gestor/técnico, proteção do próprio acesso, idempotência, concorrência, rollback após alteração central, leitura por equipa e tarefas preservadas. O cenário então usado com outra membership ativa da mesma identidade foi posteriormente substituído pela regra de vínculo único descrita em [uma conta de entidade, uma entidade](single-organization-membership.md); o isolamento A/B passa a usar identidades distintas. Chrome 1440/390 confirmou atribuição/releitura e suspensão/reativação sem erro de página ou botões cortados. Migração 019 e reversão verificadas; ativação local com backup protegido, contas/grants/dados anteriores inalterados. API e worker saudáveis. OIDC habitual confirmou uma conta administrativa; nenhuma conta real foi criada ou convertida. [Provas e limites](../reviews/organization-internal-access-profiles.md).
