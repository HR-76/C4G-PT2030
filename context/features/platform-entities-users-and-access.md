# Entidades, utilizadores e acesso C4G

Estado: In Progress, 18/10/2026. Pedido do utilizador: criar a feature de criação de entidades e utilizadores, disponibilizar recuperação de password, apresentar login na página inicial e uniformizar a identidade visual do Keycloak, incluindo Segurança da conta.

## Decisões confirmadas

**Atualização do percurso de novas entidades:** a C4G inicia apenas com nome e email do futuro administrador; a pessoa convidada preenche a ficha obrigatória antes de aceder à nova entidade. Ver [detalhe da adesão restrita](platform-entity-invited-registration.md) e [plano técnico do convite e ficha](platform-entity-invited-registration-plan.md), que prevalecem sobre a sequência antiga de recolha de dados pela C4G. Login sem registo público; utilizadores adicionais em entidades existentes mantêm o percurso operacional atual.

- C4G cria entidades e o primeiro administrador. Entrega inicial por ligação temporária manual, já confirmada; nunca entregar uma password escolhida pela C4G.
- C4G e administrador da entidade podem adicionar Administrador, Gestor ou Técnico. Gestor só pode adicionar Técnicos à própria entidade/equipa. Técnico não cria contas. Nenhuma destas ações concede C4G_ADMIN.
- Identidade global única e memberships centrais por entidade. Conta existente conserva password, identidade e restantes vínculos; aceita explicitamente o novo acesso. Parceiros continuam apenas informativos, sem acesso externo.
- **Envio real de email continua para o final**, reconfirmado neste pedido. A recuperação será nativa do Keycloak; antes de SMTP estar operacional não afirmar que foi enviado um email nem apresentar um envio aparentemente funcional.
- Confirmado pelo utilizador: página inicial `/` abre diretamente o formulário C4G do Keycloak para visitantes, sem botão intermédio. Uma única transação OIDC por montagem, incluindo StrictMode; substituição no histórico evita regressar automaticamente à ponte de entrada. Quem já está autenticado mantém o destino correspondente ao seu perfil. `/login` mantém compatibilidade e retorno ao percurso protegido. Recuperação adiada continua acessível no próprio formulário nativo, sem simular envio.
- Login, ações de password e área de conta Keycloak usam logótipo, cores, foco e tipografia coerentes com C4G. O formulário de credenciais continua no Keycloak via OIDC/PKCE; não criar outro armazenamento ou verificação de passwords.

## Percursos e critérios de aceitação

### Entidade e primeiro administrador

Reutilizar [contrato visual](platform-entities-and-users.md), [plano](platform-entities-implementation-plan.md), [serviço](platform-onboarding-service.md) e [adaptadores reais isolados](platform-onboarding-real-adapters.md). Nova entidade → identificação → primeiro administrador → rever → criar → acompanhar preparação/ativação. Nome, denominação legal, país, tipo e moeda visíveis; nenhuma identificação legal fabricada. A revisão confirma os valores efetivamente enviados. Estados de registo, espaço e acesso separados.

Antes da ligação ao ambiente habitual: composição operacional com segredos próprios fora da API pública, diretório real de várias entidades, migração aditiva com backup/restore comprovado, autorização e auditoria C4G atuais. Repetição, resposta perdida, retoma após falha, revogação e isolamento A/B têm de passar; não duplicar entidade ou conceder acesso antes de preparação concluída.

### Outros utilizadores

Ação Adicionar utilizador na ficha de entidade para C4G e em Acessos para administrador/gestor. Nome, email e perfil obrigatório, limitado pelo servidor à matriz confirmada. Não pressupor que pertença à entidade dá acesso a todas as candidaturas: técnicos continuam por equipa. Adicionar um técnico à entidade e incluí-lo numa candidatura são ações distintas.

Procurar/reutilizar identidade no servidor sem revelar a um gestor entidades ou perfis externos. Confirmação do nome/email/perfil, convite com uso único e validade, emitir/copiar/revogar/substituir manualmente conforme o primeiro acesso. Conta/vínculo pendente não é um acesso ativo. Histórico administrativo conserva autor, data e resultado, sem segredo. Não reativar automaticamente vínculos suspensos/removidos. Implementação requer extensão explícita do serviço atual, que só cria a entidade com o primeiro administrador.

Testar administrador e gestor, tentativa de elevação, organização adulterada, técnico recusado, conta nova/existente sem vínculo operacional, recusa de segundo vínculo não removido, repetição/concorrência, convite inválido/expirado/revogado/usado e preservação das candidaturas/tarefas existentes.

### Login, recuperação e segurança da conta

Entrada em `/` e `/login`, retorno autorizado após OIDC e sessão existente sem ciclos. Ligação “Esqueci-me da password” visível; enquanto email está adiado abre orientação explícita de indisponibilidade, sem recolher emails/passwords ou simular envio. Preparar a ativação posterior do mecanismo nativo de recuperação, condicionada a SMTP validado e política de recuperação/MFA verificada. A preparação visual não equivale a recuperação operacional.

Tema Account herda `keycloak.v3`, tema Login mantém herança `keycloak`; usar CSS/recursos e evitar substituir a aplicação de conta. Mudanças de tema restritas ao realm habitual identificado, preservando contas, credenciais, MFA, políticas, sessões e fluxos. Configuração repetível para instalações futuras. Recuperação e registo público mantêm-se desativados até os respetivos gates.

Validação: build, testes dirigidos de navegação, Chrome 1440/390, login OIDC real, Segurança da conta, contraste/foco, sem overflow. Conferir que tema e logótipo foram carregados e as ações nativas continuam presentes; não alterar passwords nem MFA de contas reais para testar aparência.

## Direção visual

Atualização confirmada por referência visual enviada pelo utilizador: login em duas áreas, inspirado na composição Cloudflare anexada. Formulário nativo à esquerda sobre branco, largura legível de cerca de 380 px; logótipo no topo esquerdo; painel C4G verde-petróleo à direita (42% do desktop), com apresentação do produto e textura gráfica discreta. Segoe UI, título de formulário 26/600 e título lateral 40/600; tokens C4G existentes. Em móvel: formulário primeiro e painel resumido abaixo, sem overflow. A referência serve a composição; serviços sociais, registo público, eventos e links legais não configurados não são funcionalidades deste incremento. Rever desktop 1440/1920 e móvel 390, formulário, visibilidade da password, erros/ações nativas e OIDC real. Preservar acesso direto de `/` e `/login`, recuperação adiada e configurações de conta.

Continuar a composição C4G existente. Tokens: verde-petróleo #075B59, verde de ação #39751F, marca #5FAD2F, texto #20262B, fundo #F6F8F8, superfície #FFFFFF. Tipografia de sistema Segoe UI como no tema atual, títulos 24/600, conteúdo 14–16 px. Login com marca e acesso legíveis; conta com cabeçalho verde-petróleo e conteúdo branco, navegação e tabelas nativas. Foco visível e navegação por teclado. Formulários administrativos em página com revisão final; sem indicadores ou efeitos decorativos novos.

## Estado da execução

Correção solicitada após captura do utilizador: `/login` também deve abrir diretamente o formulário, incluindo entradas após logout/sessão expirada. Eliminar a exceção visual desta rota; preservar o destino interno recebido pelo React Router e validar raiz, alias e reload no browser antes de declarar resolvido.

Incremento de login/identidade em Review: entrada direta no formulário confirmada pelo utilizador e implementada em `/`; orientação de recuperação também no formulário nativo e tema Account verificados no ambiente habitual. [Provas e limites](../reviews/platform-access-identity.md). Login real, regresso à aplicação e sessão já existente PASS, sem botão intermédio na raiz. [Plano operativo da criação](platform-entities-users-operational-plan.md) detalha a composição e separa o primeiro administrador dos utilizadores adicionais. Nenhum comando de criação foi montado no ambiente habitual neste incremento.

## Execução ordenada

1. Login inicial, orientação de recuperação adiada e tema C4G de conta, independentes das migrações de onboarding.
2. Composição operacional recuperável do serviço existente; prova numa segunda entidade antes de ligar o formulário de criação.
3. Formulário de entidade/primeiro administrador e resultado real, com teste completo de ativação manual.
4. Extensão para utilizadores adicionais com a matriz de autoridade confirmada, convites e ecrãs C4G/Acessos.
5. Quando autorizado/configurado o email: ativar recuperação nativa, comprovar entrega/expiração/reutilização e efeito nas sessões; então fechar esse percurso.

Fontes técnicas consultadas: [temas oficiais](https://www.keycloak.org/ui-customization/themes), [Administração Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html), [tema Account da versão 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/js/apps/account-ui/maven-resources/theme/keycloak.v3/account/theme.properties). A aparência de login e a de conta são tipos de tema distintos; recuperação depende das definições de email do realm.

Próximo passo: continuar a composição operacional de criação da entidade/primeiro administrador, antes da ligação do formulário.
