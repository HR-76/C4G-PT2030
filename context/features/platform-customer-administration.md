# Administração C4G — clientes, utilizadores, faturação e comunicação

Estado: Draft — análise solicitada em 18/10/2026. Implementação não iniciada nem autorizada por este pedido. O utilizador confirmou que o serviço será pago; modelo de cobrança, valores e fornecedores não foram escolhidos.

## Objetivo e fronteiras

Acrescentar à administração da plataforma C4G três áreas ligadas à mesma ficha de entidade cliente: Entidades e utilizadores, Subscrições e faturação e Comunicação com clientes. Manter Fontes/API e Catálogo central. Estas áreas são da C4G; o ecrã Acessos de cada entidade conserva o seu âmbito e perfis atuais.

Não conceder ao administrador da plataforma leitura automática das candidaturas privadas. Preservar isolamento, histórico, acessos por equipa e parceiros apenas informativos. Pessoa do diretório, identidade global, associação à entidade e contacto comercial são conceitos distintos. Uma pessoa pode ter vários vínculos, sem duplicar a identidade.

## Evidência atual

- `frontend/src/components/Layout/Sidebar.jsx` oferece Fontes e Catálogo na área Plataforma C4G; não apresenta administração comercial de clientes.
- `frontend/src/App.jsx`: `/utilizadores` usa OrganizationAccess no runtime atual. Gestão de perfis e suspensão/reativação de contas já associadas existe por entidade; não constitui criação de clientes ou convites.
- [Perfis internos](organization-internal-access-profiles.md) e [conta nominativa C4G](../references/local-named-platform-admin.md) fornecem a base de autorização e identidade, não um portal de criação de entidades.
- [Diretório e ciclo de vida](../decisions/tenant-directory-and-lifecycle.md) distingue estado contratual, preparação técnica e disponibilidade da base. A instalação local não demonstra provisionamento dinâmico de clientes em produção.
- [Comunicação recuperada](c4g-pilot-parity-delivery-4-communication.md) consiste em avisos dentro de uma entidade, enviados pelo seu administrador. Não é uma lista comercial central nem envio de newsletters.
- [Serviços externos](../decisions/hosting-and-external-services.md) prevê Resend para email transacional. Configuração e envio real continuam adiados por decisão do utilizador; fornecedor/capacidade de newsletters não ficam implicitamente escolhidos.
- Não foi identificado um módulo de subscrições/faturação nas rotas e contratos consultados. Planos comerciais permanecem em aberto na visão de produto.

## Proposta funcional inicial — sujeita a confirmação

### 1. Entidades e utilizadores

Detalhe solicitado posteriormente pelo utilizador: [ecrãs, campos, percurso e critérios de aceitação](platform-entities-and-users.md). O utilizador confirmou ativação por ligação temporária entregue manualmente pela C4G, mantendo email automático adiado. Mantém-se em Draft, sem implementação; integração de identidade e preparação do espaço ainda por concretizar.

Lista pesquisável de clientes e ficha com identificação, contacto principal, estado contratual e estado de preparação técnica separados. Lista de contas associadas com perfil e estado, usando as regras internas já aprovadas. Ações de criar entidade, preparar primeiro administrador e associar/convidar contas devem mostrar resultado e falhas recuperáveis.

Começar por criação assistida pela C4G. Não abrir registo público automático. Reutilizar uma identidade existente pelo percurso seguro de associação; não associar contas apenas porque alguém escreveu o mesmo email. Suspender o acesso a uma entidade não suspende automaticamente a identidade nas restantes. Atribuição de administrador C4G é uma operação distinta da administração de cliente, com proteção do próprio acesso e do último administrador.

O percurso não pode declarar uma entidade utilizável sem base isolada, esquema validado, ligação disponível e primeiro acesso autorizado. A fase local pode demonstrar o fluxo; produção continua sujeita aos requisitos de provisionamento e recuperação existentes.

### 2. Subscrições e faturação

Ficha comercial por entidade: identificação fiscal e contacto de faturação, condições contratadas, valor/moeda, periodicidade, início, renovação e estado. Histórico de documentos emitidos e pagamentos, com origem e referências verificáveis.

Recomendação inicial: contrato/subscrição por entidade, com condições acordadas e acompanhamento manual, antes de cobrança automática. É uma proposta, não uma decisão sobre preço, utilizadores incluídos, impostos ou limites.

Separar acompanhamento comercial, emissão fiscal e cobrança. Preferir ligação ao sistema de faturação usado pela C4G; numa primeira fase, registar referências de documentos emitidos nesse sistema. Não apresentar um PDF gerado pela aplicação como fatura fiscal, nem um comprovativo do processador de pagamentos como substituto automático da fatura. Integração e regras fiscais dependem da solução e enquadramento confirmados.

Atraso de pagamento não elimina dados nem altera acessos automaticamente nesta proposta. Eventual suspensão, período de tolerância, cancelamento e retenção exigem política expressa. Estado financeiro não deve ser confundido com avaria técnica. Anexar documentos depende do armazenamento/antivírus ainda pendentes; referências externas podem anteceder essa configuração.

### 3. Comunicação com clientes

Área central para selecionar destinatários, preparar mensagem, pré-visualizar, confirmar e consultar histórico de entrega/falhas. Proposta de audiência inicial: contactos principais/administradores das entidades selecionadas. Alargar a todos os utilizadores depende de confirmação; parceiros registados nas candidaturas não entram automaticamente.

Distinguir avisos de serviço/contratuais de newsletters promocionais. Para newsletters, registar elegibilidade e preferências, consentimento quando aplicável, oposição e cancelamento da subscrição. Não pressupor que uma conta criada autoriza marketing. Não expor endereços de outros clientes; deduplicar destinatários e impedir reenvio acidental após resposta incerta. Não acrescentar acompanhamento de abertura/cliques nesta primeira fase.

Preparação de rascunhos pode anteceder a configuração do serviço. Envio real só pode ser declarado operacional após configuração e validação de entrega, falhas, oposição e ausência de duplicados. Nenhum email ou newsletter foi enviado nesta análise.

## Ordem proposta e decisões abertas

1. Confirmar o recorte Entidades e utilizadores e especificar criação assistida, primeiro administrador e associação segura de contas. Implementar/validar este percurso primeiro.
2. Confirmar modelo comercial e sistema de faturação existente; preparar acompanhamento de contratos, documentos e pagamentos. Automatizar emissão/cobrança apenas após escolher a integração.
3. Confirmar audiência e finalidade das comunicações; preparar rascunhos e histórico, mantendo email real para a configuração final já acordada.

Decisões necessárias: cobrança por entidade ou por utilizador; periodicidade e condições; software de faturação atual da C4G; destinatários iniciais das comunicações. Não são necessárias para aceitar a organização geral do menu, mas condicionam os contratos e a implementação de cada área.

## Impacto técnico previsto

- Navegação e páginas de administração de plataforma, cliente HTTP centralizado e novas rotas com autoridade C4G verificada no servidor.
- Dados comerciais e de gestão de clientes na Central, separados dos dados privados de candidaturas. Evolução aditiva com auditoria e revisão concorrente; contratos de migração a definir por incremento.
- Criação de entidades liga identidade, memberships e ciclo de vida/provisionamento existente; não será apenas um formulário que insere uma linha.
- Faturação e email através de adaptadores e processamento idempotente, com segredos fora do frontend/repositório. Não escolher fornecedores, custos ou novos motores de configuração nesta análise.

## Critérios de aceitação propostos

1. Apenas C4G autorizado administra clientes; administrador/gestor de entidade mantém apenas os poderes confirmados. Testes HTTP com duas entidades provam isolamento e recusas, incluindo exportação quando exista.
2. Criação repetida ou falhada não duplica entidade, conta ou vínculo, nem deixa acesso utilizável antes da preparação técnica. Demonstrar recuperação em ambiente descartável e percurso real no browser.
3. Gestão de um vínculo preserva outros vínculos, tarefas e histórico; proteção do próprio acesso/último administrador, revogação e concorrência verificadas automaticamente.
4. Ficha comercial distingue contrato, documento fiscal, pagamento e estado técnico. Nenhuma cobrança, fatura ou suspensão é inventada por ausência de integração; valores e totais conferidos com a origem.
5. Comunicação mostra conteúdo e destinatários antes da confirmação; separa finalidades, respeita oposição e não duplica nem expõe clientes. Provar com destinatários de teste autorizados antes de envio operacional.
6. Cada incremento exige testes direcionados, sintaxe/backend, build/frontend e revisão visual desktop/móvel. Testes não substituem o percurso funcional. Esta análise alterou apenas documentação; não executou validação de funcionalidades novas.

## Referências oficiais consultadas em 18/10/2026

- [AT — Fatura e recibo](https://info.portaldasfinancas.gov.pt/pt/apoio_ao_contribuinte/Cidadaos/Atividade_profissional/Fatura_e_recibo/Paginas/default.aspx): emissão de faturas e meios disponíveis; enquadramento concreto por confirmar com o sistema de faturação C4G.
- [CNPD — Diretriz 1/2022, marketing direto](https://www.cnpd.pt/umbraco/surface/cnpdDecision/download/121958): condições de envio e oposição; não equiparar indistintamente todas as comunicações a marketing.

Próximo passo: confirmar o âmbito inicial de Entidades e utilizadores e detalhar o percurso de criação de uma entidade com o seu primeiro administrador.
