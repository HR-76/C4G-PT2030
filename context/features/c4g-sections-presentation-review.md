# Revisão das secções da entidade

Pedido: rever apresentação e funcionamento das secções existentes, mantendo a simplicidade do produto. Não introduzir funcionalidades novas por inferência.

## Critérios de aceitação

- Nomes dos cabeçalhos coerentes com a sidebar, incluindo Pessoas, Unidades, Acessos e Segurança da conta.
- Títulos principais legíveis e consistentes nas páginas revistas; hierarquia sem duplicação do título principal no cabeçalho global.
- Perfil da organização encaminha para o Matching recuperado e deixa de consultar os serviços de qualificação indisponíveis. Preservar código e rotas existentes.
- Listas vazias não apresentam «Página 0 de 0»; controlos de paginação usam os estilos C4G e mantêm o regresso de páginas posteriores vazias.
- Rever as 13 secções da entidade em 1440 e 390 px, sem criar candidaturas, pessoas ou mensagens. Distinguir falhas reais de operações bloqueadas pela revisão de leitura.
- Build frontend e testes direcionados sem regressões. Preservar autorização, dados e isolamento.

## Direção visual

Manter verde petróleo C4G, verde nas ações, fundo claro e tabelas densas. Usar a tipografia do sistema existente, títulos de página de 24 px, descrições curtas e espaçamento consistente. Agrupar dados e ações em superfícies discretas; evitar cartões decorativos e novos indicadores sem significado.

## Evidência inicial

A ficha da organização consulta dois serviços de qualificação que respondem 503. A página de candidaturas sem registos mostra «Página 0 de 0». A paginação de oportunidades privadas não usa classes de botão. Várias páginas não têm título principal no conteúdo e os nomes do cabeçalho diferem da sidebar. A leitura de alertas depende de uma atualização de prazos que a auditoria bloqueia: este resultado não comprova uma falha da aplicação.

## Limites

Correção de resiliência confirmada por leitura do código: se a atualização de prazos falhar por rede/5xx, consultar os alertas guardados pela API autorizada e mostrar aviso de atualização pendente. Não continuar após recusa de acesso 4xx. Testar falha transitória e recusa, preservando proteção contra respostas de outra sessão/organização.

Armazenamento, antivírus e email permanecem adiados. Importação central Portugal 2030 ainda requer composição operacional. Faturação e comunicação comercial são âmbito futuro; não implementar nesta revisão. A revisão visual de listas vazias não substitui uma validação dos percursos de edição e detalhe com dados de uma entidade de teste.

## Implementação e validação

Cabeçalhos e títulos alinhados; ficha da organização com superfícies e botões definidos e ligação ao Matching ativo; retiradas as duas consultas a serviços de qualificação indisponíveis. Paginação vazia corrigida em candidaturas, oportunidades e parceiros. Alertas guardados continuam consultáveis após falha transitória na atualização de prazos, com aviso e repetição explícitos; recusas 4xx continuam a interromper o percurso.

83 testes direcionados passaram em dez ficheiros; os dois testes de parceiros foram novamente executados após o ajuste final. Build frontend passou. Nenhuma migração, alteração de permissões ou escrita de dados de negócio. A revisão nativa bloqueia operações de escrita de negócio, incluindo geração automática de alertas; autenticação normal regista entradas nos logs.

Evidência visual em `output/playwright/sections-review/`, `sections-review-after/` e `sections-review-after-platform/`: 13 secções da entidade e sete da Administração C4G, a 1440 e 390 px. A revisão inclui páginas de entrada/listas; não certifica todos os diálogos, detalhes, exportações ou percursos de escrita.

### Questão ainda a tratar

**Média — desempenho de `/matching`.** Duas verificações de carregamento excederam 30 segundos; com espera mais longa a página terminou sem erros e mostrou dez correspondências. O serviço `backend/src/organizationDirectory/matching.js` consulta sequencialmente o detalhe das oportunidades ativas, uma possível causa a medir. Não atribuir uma duração exata ao endpoint com base no `networkidle` do browser. Próximo recorte: medir as consultas e reduzir o custo preservando resultados determinísticos e revalidação de autoridade. Não foi alterado o motor nesta revisão visual.

### Preparação para utilização profissional

Priorizar fiabilidade e conclusão do âmbito confirmado: desempenho do Matching; demonstração completa de candidaturas/relatórios e isolamento com duas entidades de teste; anexos reais; email transacional e recuperação de password; importação central Portugal 2030. As três últimas integrações mantêm a configuração final já acordada. Para comercialização, especificar condições de subscrição/faturação e comunicação com clientes antes da implementação. Não acrescentar IA, scoring, acesso de parceiros ou ferramentas de qualificação para preencher o menu.
