# Perfil da Organização C4G — estrutura e pessoas

Estado: Complete — recorte local, 2026-10-17. Correção dos dois atalhos e revisão do perfil concluídas conforme pedido do utilizador. Não declara publicação/matching ativos nem prontidão de produção. [Evidência e limites](../reviews/organization-profile-recovery/README.md).

## Resultado

Recuperar a apresentação do perfil e da lista de pessoas do piloto, adaptada à estrutura **Organização → Departamentos/Unidades → Pessoas**. A organização selecionada é sempre a entidade de trabalho. A identidade visual é C4G, sem pressupor universidades, faculdades ou investigadores.

## Reutilização e limite técnico

- Identidade da organização, sessão e memberships centrais existentes; nenhuma conta ou permissão implícita ao registar uma pessoa.
- Tabela `organizational_scope.scope`, contratos e serviço preparado F13-P1 para criar, renomear e mudar a unidade superior. Unidades são `UNIT`; a árvore não concede acesso por herança. Sem arquivo de unidades nesta recuperação.
- Componentes visuais/tabelas/formulários do perfil e investigadores; tokens e navegação C4G atuais.
- Rotas e ligações do perfil editorial e publicação/matching preservadas, sem as transformar em condição para preencher a estrutura. A disponibilidade desses serviços continua dependente da sua composição/configuração; esta entrega não os ativa.
- Não existe diretório genérico de pessoas no tenant. A extensão mínima acrescenta ficha descritiva da organização, pessoas e afetações a unidades, com integridade, revisão, idempotência e auditoria. Não reutilizar os professores globais do legado nem duplicar identidades centrais.

## Critérios de aceitação

1. `/perfil-organizacao` apresenta identificação central, descrição/contacto/website opcionais e separadores para unidades e pessoas; estados de carregamento, vazio, recusa e erro com recuperação explícitos.
2. Gestor com grants adequados cria e renomeia unidades, escolhe a unidade superior e vê a hierarquia. Ciclos, pais inativos e referências de outra organização são recusados pelo serviço existente.
3. Gestor autorizado regista/edita pessoas (nome obrigatório; email e função opcionais), associa uma ou várias unidades e identifica a principal; pode marcar a pessoa como inativa preservando o registo. Uma pessoa pode estar diretamente afeta à organização, sem unidade. Registar não cria utilizador, membership ou acesso.
4. Listagem com pesquisa, filtro por unidade/estado e paginação; afetações e unidade principal visíveis. Utilizador só de leitura não recebe ações de edição. Autoridade sempre verificada no backend, não inferida do nome do papel.
5. Isolamento por tenant e contexto; validação de entrada, SQL parametrizado, revisão concorrente, repetição idempotente e auditoria transacional. Alterações de sessão/organização eliminam dados/formulários anteriores e respostas tardias são ignoradas.
6. Catálogo central, autenticação, candidaturas, trabalho paralelo e residual preservados. Sem reativar endpoints globais legacy, importar pessoas do piloto ou criar dados de negócio automaticamente.
7. Sintaxe, testes direcionados de contratos/autorização/isolamento/persistência, testes de interface e build. Provas com dados sintéticos identificadas e separadas de disponibilidade no ambiente habitual.
8. Os atalhos “Temas e prioridades” e “Perfil publicado” só permitem navegar após confirmação pelas leituras de contexto existentes. Durante a consulta, indisponibilidade ou recusa de acesso, apresentar o estado junto ao respetivo nome, sem enviar o utilizador para uma página de erro. Permitir verificar novamente, tratar cada serviço independentemente e ignorar respostas antigas após mudança de organização. Não ativar serviços, mudar grants ou alterar a publicação/matching.

## Correção resultante da revisão

A revisão de leitura em 5189 confirmou ambos os contextos editoriais com 503. O perfil principal e os formulários funcionam; as ligações incondicionais sugerem disponibilidade inexistente. A correção reutiliza os GET existentes, com timeout limitado e a fila de pedidos organizacionais atual; a disponibilidade é apenas apresentação e não substitui autorização no destino. Não acrescenta endpoints, configurações, tabelas ou funcionalidades de domínio. Verificação: estados disponíveis/indisponíveis/recusados e respostas tardias em testes de interface, build e nova passagem na demonstração sem gravações de negócio.

Conclusão: 21 testes frontend direcionados e build PASS. Chrome com OIDC real nas duas entidades e larguras 1440/768/390 PASS; os dois atalhos ficam sem navegação quando os serviços respondem 503, com mensagem local e possibilidade de nova consulta. Todas as leituras do diretório 200; catálogo e candidatura preservados, zero escritas de negócio. Critério 8 satisfeito; os critérios anteriores conservam a evidência da implementação e da revisão. Nenhuma outra funcionalidade iniciada.

## Fora do recorte

Gestão de contas/convites/permissões, migração automática de professores, organigramas gráficos, RH, novos domínios de matching e publicação, arquivo de unidades e alteração do nome legal/identidade central. A ficha descritiva não altera o perfil publicado usado no matching.

## Integração e validação

A migration incremental foi validada em PostgreSQL 17 e 18 isolados antes de ser aplicada aos dois tenants da demonstração 5189/5561. Catálogo e candidaturas existentes foram comparados antes/depois, sem alterações. A prova real OIDC abriu o perfil e formulários nas duas entidades, sem escrita de negócio. A configuração e instalação do PostgreSQL nativo continuam sob a tarefa própria; não foram executadas por esta entrega.
