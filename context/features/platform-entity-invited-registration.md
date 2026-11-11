# Adesão restrita — convite à pessoa e ficha da entidade

Estado: In Progress — convite e sessão limitada implementados em composição isolada, com [provas e limites](../reviews/platform-entity-admission.md). Ficha, integração e ativação da entidade continuam pendentes conforme o [plano técnico](platform-entity-invited-registration-plan.md). 18/10/2026.

**Âmbito geográfico confirmado:** apenas Portugal nesta primeira versão, por decisão do utilizador. País da entidade e da sede fixos em Portugal (`PT`), moeda de reporting fixa em EUR, apresentados como informação e não como seletores. O servidor recusa outros países/moedas neste percurso. Não restringir domínios de email a `.pt`, nem inferir nacionalidade da pessoa. O âmbito PT aplica-se à entidade; o contacto profissional do administrador pode ter indicativo estrangeiro válido. Nenhuma alteração retroativa a registos existentes.

## Objetivo e precedência

A C4G inicia a adesão apenas com nome e email do futuro administrador. A pessoa convidada autentica-se e preenche os dados obrigatórios da entidade antes de obter acesso operacional. Página inicial com login, sem signup, criação pública de contas ou pedido público de adesão.

Este percurso substitui, para novas adesões, o formulário anterior em que a C4G preenchia os dados da entidade. Não altera o painel já operacional de utilizadores em entidades existentes. O detalhe abaixo concretiza a proposta conversada; ainda não constitui implementação nem migração autorizada por este pedido de análise.

Proposta de ativação: sem uma segunda aprovação C4G nos casos normais; o convite é o controlo de admissão. Exceções de identidade/duplicação exigem resolução C4G. Acesso operacional depende de ficha válida, convite aceite, autoridade atual e preparação técnica concluída.

## 1. C4G — Convidar administrador de nova entidade

Dois campos obrigatórios: Nome completo (até 200 caracteres) e Email (até 254). Nome aceita acentos e nomes de uma palavra; não exigir um número mínimo de palavras. Remover espaços exteriores, rejeitar campos vazios/caracteres de controlo e validar sintaxe do email no servidor. Reutilizar a normalização de identidade existente, sem equivalências inventadas entre aliases de email.

Perfil apresentado, não editável: Primeiro administrador da entidade. A entidade ainda não existe; não pedir NIF, nome de entidade, slug, base de dados ou plano comercial. Ação Rever convite, seguida de Criar convite. A C4G recebe resultado e ação Emitir ligação, com entrega manual, prazo explícito e substituição/revogação. Nome/email não equivalem a identidade autenticada nem a email verificado.

Conta existente: conservar identidade, password e outros vínculos. Uma coincidência de email sem identidade reconciliada não permite apropriação. Antes de emitir outro convite aberto para o mesmo destinatário, mostrar o anterior à C4G e permitir retomar/substituir; uma nova adesão a outra entidade exige intenção explícita, sem criar convites em cascata por duplo clique.

Convites ficam numa lista separada das entidades: Nome, Email, Criado em, Criado por, Estado, Validade e Ações. Não apresentar registos incompletos como entidades ativas. Um convite autoriza concluir uma única entidade; alterar destinatário depois da emissão exige revogar e criar nova intenção.

## 2. Ativação da pessoa

Ligação temporária de uso único, 24 horas, reutilizando os mecanismos existentes onde compatíveis. GET não aceita convite. Identidade nova define password no Keycloak; identidade existente autentica-se na conta esperada. Após aceitação confirmada, a ligação é consumida e a retoma da ficha passa a usar a sessão autenticada e a autorização persistida, não o segredo do convite.

Expiração da ligação limita a aceitação inicial; não elimina nem expira automaticamente uma ficha já aceite. Revogação posterior pela C4G bloqueia a adesão pendente, incluindo conclusão em curso. Preservar rascunho e histórico; não apagar contas ou outros vínculos. Só a C4G pode renovar/reabrir explicitamente uma adesão bloqueada, conforme transição a definir no contrato técnico.

Novo utilizador sem vínculos: só ficha pendente, segurança da conta e sair. Catálogo, candidaturas, matching, equipa e administração indisponíveis nesta adesão. Conta com outros vínculos ativos continua a poder usá-los: o bloqueio é da nova adesão e nunca global. API deve aplicar estas fronteiras; redirecionar a interface não basta.

## 3. Formulário — Completar ficha da entidade

Cabeçalho: título, estado Por completar, explicação de que os campos com * são obrigatórios e data/hora da última gravação confirmada. Quatro passos, sem percentagens fictícias: Identificação → Morada e contactos → Administrador e dimensão → Rever e concluir.

| Campo | Obrigatoriedade | Validação/comportamento proposto |
| --- | --- | --- |
| Denominação legal | Obrigatório | Texto até 200; não vazio. |
| Nome apresentado | Obrigatório | Até 200; opção explícita Usar a denominação legal. Não exige unicidade por nome. |
| País da entidade | Fixo | Portugal, visível e não editável. Servidor fixa PT. |
| NIF | Obrigatório | Texto de nove algarismos; validar formato e dígito de controlo com implementação testada. Não converter para número nem apresentar como comprovativo de existência legal. |
| Tipo de entidade | Obrigatório | Lista fechada de tipos suportados, com rótulos claros. Não aceitar Não indicado na conclusão. Tipos adicionais dependem de decisão explícita; sem configuração livre neste incremento. |
| Morada da sede | Obrigatório | Rua/lugar e número quando existente, até 250; não exigir número de porta universalmente. |
| Complemento da morada | Opcional | Até 150. |
| Código postal | Obrigatório | Formato 0000-000, sem aceitar uma opção Não aplicável. Verificação de formato não confirma a morada. |
| Localidade | Obrigatório | Até 150. |
| País da morada | Fixo | Portugal, visível e não editável; inclui continente e regiões autónomas. |
| Email institucional | Obrigatório | Sintaxe válida, até 254; opção explícita Usar o email do administrador. Não cria outra conta. |
| Telefone institucional | Obrigatório | Indicativo e número, formato plausível por país; aceitar apresentação com espaços e normalizar no servidor. Validade de formato não prova titularidade. |
| Nome do administrador | Obrigatório, previamente preenchido | Identidade do convite; não trocar o titular neste formulário. Correção de nome segue o percurso próprio, sem renomear silenciosamente uma conta global existente. |
| Email de acesso do administrador | Obrigatório, previamente preenchido | Não editável nesta ficha. Correção de destinatário pela C4G, com reconciliação e revogação do convite quando aplicável. |
| Telefone profissional do administrador | Obrigatório | Permitir Usar o telefone institucional; não exigir dois números diferentes nem telefone pessoal. |
| Cargo do administrador | Opcional | Até 150. Administrador da aplicação não equivale a representante legal. |
| Número de trabalhadores | Obrigatório | Inteiro não negativo, zero permitido, sem arredondar decimais. Informação declarada de pessoas ao serviço, não número de utilizadores, parceiros, FTE ou classificação automática de PME. |
| Data de referência dos trabalhadores | Obrigatório | Data civil válida, não futura; não preencher silenciosamente com hoje. |
| Website e sigla | Opcionais | URL HTTP(S) válida e sigla até 50. Não desencadeiam recolha externa. |

O formulário não solicita password, IBAN, documentos, pagamento, plano comercial, competências ou organograma. Não associa newsletters automaticamente. Moeda de reporting, exigida pelo serviço atual: EUR, fixa e visível na revisão. Identificador técnico da entidade é gerado pelo servidor.

## 4. Gravação, revisão e conclusão

- Guardar e sair permite campos obrigatórios ainda vazios. Campos presentes inválidos recebem erro; nunca apresentar Guardado sem confirmação. Rascunho persistido no servidor, acessível apenas à pessoa autorizada e à C4G; não guardar contactos ou tokens em localStorage.
- Continuar valida os campos do passo. Voltar preserva valores. Sair com alterações não gravadas avisa. Dois separadores em conflito não sobrescrevem a revisão mais recente silenciosamente.
- Rever apresenta todos os valores e os campos opcionais não preenchidos, com Editar por bloco. Botão final: Concluir ficha e preparar acesso. Texto explica que a preparação pode demorar e que não equivale a envio de email nem contratação/pagamento.
- Erros junto ao campo e resumo no topo, foco no primeiro erro, valores preservados. Exemplos: Preencha a denominação legal; Indique um número inteiro igual ou superior a zero; A data de referência não pode ser futura.
- Servidor valida novamente o conjunto e a autorização. Duplo clique/resposta perdida retoma a mesma intenção, sem duplicar entidade, identidade, tenant ou membership.
- Após submissão: Ficha concluída — a preparar acesso. Quando todas as condições estiverem satisfeitas: Entidade pronta — Entrar na plataforma. Falha técnica: preparação por confirmar, com retoma da mesma operação; não obrigar a preencher novamente.

## 5. Identidade fiscal e exceções

Verificar duplicação pela combinação país + identificador fiscal normalizado, incluindo registos reservados/em preparação e entidades suspensas/arquivadas. Concorrência entre convites tem de ser resolvida no servidor: apenas uma criação pode concluir para a mesma identidade fiscal.

Mensagem ao convidado: Não foi possível concluir com esta identificação fiscal. Contacte a C4G para verificar a associação. Não revelar dados, administradores ou candidaturas da entidade encontrada. Nunca atribuir administração de entidade existente apenas por conhecer o NIF. A C4G resolve através do percurso de acessos existente, quando apropriado; não fundir nem reabrir registos automaticamente.

Validação sintática não prova existência legal. Sem integração oficial verificada, não mostrar NIF verificado. NIF em falta ou inválido impede a conclusão; não aceitar zeros ou valores fictícios. Entidades estrangeiras ficam fora desta primeira versão, sem introduzir exceções administrativas que contornem o âmbito PT. A chave de duplicação é PT + NIF normalizado; a concorrência deve ser verificada também entre convites diferentes.

## 6. Ficha e datas após criação

Ficha com Dados da entidade, Contactos, Utilizadores e acessos e Histórico. Uma fonte canónica para cada dado; perfil organizacional e administração devem consumir os mesmos valores ou projeções sincronizadas, não fichas editáveis divergentes. Dados de cliente não concedem à C4G acesso às candidaturas privadas.

Datas automáticas e não editáveis: convite criado/emitido/aceite, conta criada, entidade criada, ficha concluída, acesso ativado e última atualização. Mostrar autor nas ações administrativas. Criação da entidade é o momento de persistência do registo real após ficha válida; antes disso existe uma adesão em rascunho. Data de constituição legal, se futuramente recolhida, é outro campo.

Na lista de utilizadores distinguir Conta criada em, Acesso criado nesta entidade e Acesso ativado em. Reutilizar uma conta não altera a sua data original; criar novo vínculo não a substitui. Datas em UTC no armazenamento, apresentadas com fuso explícito; referência dos trabalhadores é data civil. Histórico desconhecido aparece como Não disponível; nunca atribuir a data da migração como criação original. Início de faturação permanece separado e fora deste incremento.

O novo requisito não bloqueia retroativamente entidades ou utilizadores existentes. Eventual campanha de preenchimento de fichas antigas exige decisão própria.

## Plano técnico e critérios de aceitação

Evidência atual: `platformOnboarding/contracts.js` exige dados de entidade; `service.js` cria a organização antes de preparar identidade. `memberService.js` destina-se a organizações já existentes. Nenhum destes contratos admite diretamente o novo convite sem entidade.

1. Implementar o agregado central de adesão pré-entidade, identidade esperada, rascunho versionado, convite e autoridade limitada conforme o [plano técnico](platform-entity-invited-registration-plan.md), com migração aditiva e sem campos fictícios na organização. Cobertura PT confirmada. O plano propõe identificação legal e dados administrativos de cliente na base central, mantendo informação operacional no tenant; define a transferência controlada de email/website e o contrato de leitura/edição do perfil existente, sem segunda fonte editável divergente.
2. Adaptar a ponte Keycloak e a retoma autenticada para a adesão limitada. Preservar ativações de utilizadores em entidades existentes; testar bloqueio por API e por UI, conta nova/existente e revogação durante password/ficha/submissão.
3. Implementar contrato de ficha e conclusão idempotente, reserva fiscal concorrente e coordenação com provisionamento existente. Falha em qualquer fase conserva intenção/dados; membership operacional apenas após a preparação e projeções necessárias.
4. Implementar os dois ecrãs, lista de convites e ficha administrativa; expor datas reais sem fabricar histórico. Validar teclado, campos obrigatórios, revisão, erro/retoma e 1440/390. Confrontar visual com composição C4G existente.
5. Provar PostgreSQL/Keycloak reais com duas entidades, identidade existente, duplicate/replay, troca de destinatário, convite expirado/revogado e isolamento; preservar candidaturas/tarefas/permissões anteriores. Build frontend e sintaxe/testes backend. Só depois aplicar localmente com backup/restauro.

Critérios de conclusão: C4G usa apenas nome/email; zero signup público; convidado só acede à sua ficha pendente; obrigatórios impostos no servidor; rascunho retomável; conta existente preservada; uma entidade por intenção e identidade fiscal; datas distintas e auditáveis; acesso apenas após preparação; ausência de bloqueio retroativo; percurso real demonstrado. SMTP, faturação, documentos/antivírus e disponibilização externa continuam fora deste recorte.
