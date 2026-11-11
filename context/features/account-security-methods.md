# Segurança da conta por método
Estado: Review — 11/11/2026.

Pedido: estado e ação disponível de cada método, referência Metronic 8.3.3 Account/Security.
Critérios: linha por método com nome, estado textual e ação; consulta mobile sem overflow. API existente confirma apenas emailVerification; palavra-passe e autenticadora ficam Consultar no fornecedor, nunca Ativa/Desativada inferido. Email distingue boolean confirmado, reautenticação e indisponibilidade. Sem alteração de autenticação/política/contas; usar ações existentes. Manter feedback de cancelamento, falha, carregamento e ausência de confirmação após erro. Contexto secundário em Como funciona?; limitações de recuperação permanecem visíveis junto ao email. Validar estados e ações, teclado e desktop/mobile com fixtures; build e testes.

## Resultado e validação
Linhas por método com nome, estado e ação alinhada à direita em desktop/abaixo em mobile. Palavra-passe e autenticadora indicam Consultar no fornecedor (API não expõe estado). Email com estado confirmado e ação correspondente; resposta sem boolean não habilita alteração. Contexto secundário expansível; aviso de recuperação permanece visível. Mantidas rotas e ações existentes, sem alterações ao backend/Keycloak/política.
10 testes focados e suite frontend completa 902/902 (103 ficheiros) aprovados. Build aprovado. Chrome com API simulada a 1440/390/320 px: ativo, desativado, reautenticação, indisponibilidade e erro global; ação falhada preserva estado, Como funciona por teclado, sem overflow/erros JS. Capturas desktop/mobile inspecionadas. Não alteradas definições reais nem testado redirecionamento efetivo ao fornecedor.
Script output/playwright/account-security-methods-check.cjs; capturas seguranca-metodos-1440.png e seguranca-metodos-390.png na pasta de visualizações da sessão.
