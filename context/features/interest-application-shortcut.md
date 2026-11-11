# Interesses → Nova candidatura

Estado: Revisão

## Objetivo e âmbito

Abrir o formulário existente de nova candidatura diretamente da lista de interesses, sem exigir a passagem pela ficha do interesse. Trabalho exclusivo na GCNI_C4G, reutilizando os contratos, permissões e formulário atuais. Não acrescenta funcionalidades de negócio.

## Comportamento e critérios de aceitação

- Cada interesse ativo com permissões `canManage` e `canCreateApplication` apresenta **Nova candidatura** como ação principal. **Ver interesse** mantém o acesso à análise e às candidaturas associadas.
- A ação consulta novamente o interesse e a oportunidade central; só abre o formulário se o interesse continuar ativo, autorizado e ligado à mesma oportunidade disponível. Usa as revisões atuais.
- O formulário existente mantém título, unidades, escolha explícita de copiar notas, responsável, prazo, orçamento e confirmação **Criar candidatura**. Abrir o formulário nunca cria registos.
- O retorno conserva os filtros e a página da lista. A ficha do interesse continua acessível pelo título e ação secundária.
- Envios pendentes ou ilegíveis bloqueiam nova preparação sem apagar a intenção. Duplo clique não inicia consultas duplicadas. Troca de utilizador, organização, página ou filtros invalida a resposta anterior.
- Perda de permissão, arquivo ou falha de consulta deixam o utilizador na lista, com erro legível e possibilidade de nova consulta. Links oficiais e permissões atuais permanecem.
- Ações legíveis e utilizáveis por teclado em desktop e telemóvel, sem extravasar a tabela.

## Integração e validação

Reutilizar `opportunityInterestsApi.get`, `centralOpportunitiesApi.get` e `/candidaturas?nova=1&origem=CENTRAL&…`; a lista já inclui capabilities por interesse. Sem alteração backend ou esquema.

Regressões de navegação, permissões, pendentes e respostas tardias; suites locais e build. Percurso em Chrome com API simulada, nos perfis administrador e consulta, incluindo abertura, cancelamento, confirmação explícita e responsividade. Sem dados reais, infraestrutura ou envios.

## Resultado

Integrado botão principal **Nova candidatura** em cada interesse elegível e ação secundária **Ver interesse**. Removido o parágrafo que repetia a navegação. Construção da ligação para o formulário partilhada com a ficha do interesse; título, unidades e notas continuam tratados pelo formulário existente.

O atalho consulta novamente interesse e oportunidade central, com cancelamento ao mudar de página/contexto. Ações pendentes são preservadas e não são repetidas automaticamente. Erros de consulta permitem nova tentativa explícita. Estilos locais mantêm as duas ações legíveis em tabela e cartões mobile.

Validação: baseline vermelho confirmado nos 21 novos casos; 90 testes focados PASS; suite frontend 755 PASS (86 ficheiros); backend 2652 PASS/7 SKIP/0 FAIL; build PASS. Logs `output/interest-shortcut-{focused,frontend,backend,build}.log`. Avisos preexistentes de jsdom/React na suite geral, sem falhas. Revisão independente sem achados no âmbito alterado.

Chrome com API simulada: administrador e membro de consulta, 1440/390 px; leitura das revisões atuais, abertura por teclado, preenchimento de título/unidades, cópia explícita das notas, cancelamento sem escrita, confirmação única que abre a ficha e retorno aos filtros. Links oficiais preservados e ausência de erros de página/overflow. Gate `test/integration/local-platform/interest-access-ui.cjs`; evidências `output/playwright/interest-access/verification.json` e capturas adjacentes, verificadas visualmente. Esta prova não usa sessão real nem cria registos reais.

Próximo passo proposto: harmonizar a apresentação do formulário **Nova candidatura** com o padrão visual da ficha, mantendo os campos e regras existentes.
