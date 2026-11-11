# Revisões documentais atribuídas

## Objetivo
Ao solicitar uma revisão do conjunto documental, escolher um revisor. O dashboard do Técnico apresenta as revisões pendentes atribuídas à sua membership em todas as candidaturas acessíveis, com paginação.

## Contrato e critérios de aceitação
- O pedido novo identifica a membership do revisor na organização; preservar os pedidos históricos sem atribuição, sem escolher retroativamente uma pessoa.
- A escolha não concede permissões. Validar membership ativa, separação entre requerente e revisor e capacidade de leitura da candidatura e dos documentos e de decisão; verificar novamente no momento da decisão.
- A decisão mantém o grant específico, as guardas documentais, o snapshot de versões, a revisão esperada, a auditoria e a idempotência. Revogação ou alteração de membership não expõe documentos nem autoriza decisão.
- A lista pessoal é limitada ao revisor autenticado e à organização corrente; incluir apenas pedidos por decidir e atuais, autorizar cada candidatura e documento antes de divulgar metadados, e paginar com cursor vinculado ao contexto e à autorização. Distinguir vazio de erro e de páginas ainda não carregadas.
- No formulário, apresentar revisores elegíveis e erros claros; a seleção é obrigatória em novos pedidos. O dashboard substitui a aproximação pela primeira página de candidaturas por uma consulta própria.
- Testar atribuição, pedidos históricos, revogação, isolamento entre organizações, idempotência, decisões e paginação, bem como o formulário e dashboard em larguras representativas. Aplicação de migrations e gates com bases exigem ambiente isolado e autorização própria.

## Evidência inicial
`application_review_request` regista requerente mas não revisor; é imutável. `application.review.decide` e `document.read` são grants próprios, e participação na equipa não os concede. A lista atual do dashboard agrega contagens da primeira página e não permite inferir atribuição.

## Implementação e validação

O pedido e o respetivo recibo imutável guardam a atribuição na mesma transação. O recibo permite recuperar um envio incerto e mantém a atribuição vinculada à intenção. Os pedidos anteriores continuam legíveis e decidíveis pelas regras históricas. A migração `035_application_review_assignments` acrescenta um índice único por pedido atribuído e um índice para localizar as revisões por membership. Não reescreve dados.

O formulário consulta revisores elegíveis por página. Ao criar o pedido, o servidor volta a avaliar a candidatura, os documentos e as referências de oportunidade e avaliação para o revisor escolhido. O coordenador protege a autoridade desse revisor até ao commit. A decisão exige a membership atribuída, além da autorização vigente e do conjunto documental ainda atual. O dashboard consulta o trabalho pessoal diretamente, com cursor assinado e nova autorização para cada resultado.

A migração foi verificada numa cópia temporária do esquema PostgreSQL com recibos sintéticos, preservando o recibo histórico e recusando uma atribuição duplicada. Foi aplicada ao tenant local e a observação de esquema foi confirmada na Central. A aplicação local respondeu ao teste de saúde e o dashboard autenticado do Técnico apresentou o estado sem revisões pendentes. A seleção, o envio, a decisão, a revogação e a paginação foram verificados em testes dirigidos. Não foi criado um pedido de negócio no ambiente local.

Validação final: build aprovado e 923 testes frontend aprovados. Backend com 2 857 testes aprovados, sete ignorados e a falha preexistente SEC-AC-01 sobre armazenamento de sessão no frontend.

Estado: Review.
