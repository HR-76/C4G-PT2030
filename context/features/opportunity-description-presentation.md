# Descrição da call: apresentação e descrições PT2030

Pedido do utilizador em 14/11/2026.

## 1. Formatação da descrição na ficha — Review

A descrição guardada é texto simples com um bloco por linha (o coletor retira a marcação da fonte). A ficha mostrava-a como um único bloco contínuo.

Contrato:

- Só apresentação, em `frontend/src/pages/Opportunities/OpportunityDescription.jsx`. O texto guardado, as revisões e os digests não mudam; nada é reescrito, resumido ou traduzido.
- Cada linha passa a parágrafo com espaçamento próprio.
- Linha curta, sem pontuação final e seguida de texto corrido é apresentada como subtítulo.
- Linhas curtas a seguir a uma linha terminada em «:» e linhas com marcador (•, -, –) são apresentadas como lista.
- A nota «[Excerto — …]» fica em texto secundário.
- O conteúdo é sempre texto, nunca HTML.
- «Ler descrição completa» / «Recolher descrição» mantêm o comportamento (800 caracteres).

Critérios de aceitação: a descrição do aviso SUSA (evidência `eu-11145`) apresenta 2 subtítulos e 2 listas; o texto visível é igual ao guardado; marcação na fonte aparece como texto.

Validação: 3 testes novos, 249 testes da pasta Opportunities, lint e build aprovados. Sem verificação em browser. Limite: a estrutura é inferida, por isso um subtítulo ou lista pode não ser reconhecido; nesses casos fica como parágrafo.

Não abrangido: a tabela (excerto de 180 caracteres) e a vista de laboratório `CatalogReadWorkspace`.

## 2. Descrições dos avisos PT2030 — investigação

Problema: o Excel do Plano Anual não tem coluna de descrição, por isso o mapeamento `pt2030-plan-xlsx-v2.0` regista `description.summary` como `NOT_FOUND` e a ficha mostra «Descrição não disponível neste registo».

Factos observados em 14/11/2026, só em leitura, em `portugal2030.pt`:

- API pública do WordPress, sem autenticação: `GET /wp-json/wp/v2/aviso?per_page=100&page=N`. 172 avisos, o mesmo número da página do Plano Anual.
- `acf.id` é o ID da coluna A do Excel (172 distintos, nenhum vazio): a ligação ao registo existente é direta.
- Resumo em `yoast_head_json.og_description`: presente em 152 de 172; 76 terminam em «[…]» (corte a cerca de 55 palavras); 20 não têm texto.
- O texto integral não vem na API nem na página do aviso. Existe uma «ficha resumo» em PDF por aviso (`acf.pdf`, 172 de 172, cerca de 1,5 MB, 3 páginas); o conteúdo não foi lido.
- A API traz ainda dados que o Excel não tem: `link` (página individual do aviso), `codigo`, `prioridade`, tipologias de ação, intervenção e operação, `comparticipacao`.
- O Excel fornecido tinha 177 linhas e a API 172: há IDs do Excel sem página.

Por verificar antes de implementar: termos de utilização e `robots.txt` do site para recolha automática; estabilidade do campo Yoast; conteúdo e extração do PDF.

Proposta (recomendada): complemento separado do registo canónico.

- Recolha da API na mesma operação administrativa do carregamento do Excel (ou por botão próprio), guardada na Central por ID do plano, com data de observação e URL.
- A ficha mostra o resumo com a indicação «Resumo publicado em portugal2030.pt» e a ligação para a página do aviso; quando truncado, «Ler na fonte». A ligação «Consultar fonte oficial» passa a apontar para a página individual em vez da página geral do plano.
- A revisão canónica do Excel e os seus digests ficam intactos; sem resumo, mantém-se a mensagem atual.

Alternativa: novo mapeamento `pt2030-plan-xlsx-v2.1` que inclui o resumo no snapshot canónico. Altera digests e obriga a nova aceitação de todos os avisos PT2030.

Decisão do utilizador em 14/11/2026: **complemento separado**, com possibilidade de o Admin C4G editar a descrição e os outros dados do aviso.

## 3. Complemento da oportunidade e edição pelo Admin — In Progress

### Desenho

- Complemento guardado ao lado da oportunidade, por `opportunity_id`, fora da revisão canónica. Duas camadas: `COLLECTED` (o que a fonte pública publica, com URL e data de observação) e `EDITORIAL` (o que o Admin C4G escreveu, com autor e data). Histórico só de acrescento.
- Na leitura, o valor do Admin prevalece campo a campo; cada campo indica a origem. Uma nova recolha nunca apaga nem altera o que o Admin escreveu.
- Campos: descrição, página oficial do aviso, código do aviso, prioridades, tipologias de ação, de intervenção e de operação, taxa de comparticipação.
- Serve qualquer oportunidade do catálogo (o Admin pode escrever a descrição de um aviso EU ou manual); a recolha automática só existe para `PORTUGAL2030_PLAN`, ligada pelo ID do plano.
- Edição só por `C4G_ADMIN`, com sessão atual, CSRF e a autenticação recente das outras ações administrativas; auditada; idempotente; recusa versão desatualizada.
- Ficha: a descrição mostra a origem («Resumo publicado em portugal2030.pt» ou «Texto da C4G»), «Ler na fonte» quando truncada, e «Consultar fonte oficial» aponta para a página do aviso.

### Feito (14/11/2026)

- `backend/src/opportunities/complement.js`: campos, validação da entrada (chaves desconhecidas recusadas, texto normalizado, só URL https, limites), digest e junção das camadas.
- `backend/src/portugal2030/noticeSite.js`: leitor da API com endereço fixo, sem redirecionamentos, limite de páginas, tamanho e tempo; itens sem ID de plano, fora do site ou com ID repetido são ignorados e contados; a marcação nunca passa para o texto.
- 7 testes novos; backend 3232 aprovados, 9 ignorados, 0 falhas; lint aprovado. Nenhum pedido automático foi feito ao site pelo código; nada gravado em bases.

### Por fazer e bloqueado

1. **Migração nova da Central (053)** para a tabela do complemento. Não há tabela existente que sirva sem inventar identidades de conector. Exige: SQL e pacote com fingerprints medidos num PostgreSQL 18 descartável, e atualização das listas de versões conhecidas (preflight de oportunidades, leitor do catálogo, PDFs de faturação, admissão de email, instalador de staging e runtime local) — a falta de uma delas foi o que pôs o staging em ciclo de reinícios com a 052. **Precisa de autorização** para o gate isolado e, depois, para aplicar à Central local e à VPS.
2. Rotas (`GET`/`PUT /api/admin/central-opportunities/:id/complement`, recolha administrativa) e inclusão do complemento no detalhe lido por clientes (o leitor restrito do catálogo precisa de `SELECT` na tabela nova).
3. Ficha e formulário de edição no Admin.

### Perguntas em aberto

1. **Termos do site.** Os Termos e Condições de portugal2030.pt dizem que o conteúdo «não poderá ser copiado, alterado ou distribuído, salvo com autorização expressa da Agência, I.P.», com exceção do direito de citação com origem identificada. `robots.txt` não restringe. Mostrar o resumo com origem e ligação pode caber na citação, mas é uma decisão do utilizador (ou um pedido de autorização à Agência). Os dados factuais (código, prioridade, tipologias, taxa) e a ligação para a página são menos sensíveis do que o texto.
2. **«Outros dados» editáveis.** Assumido: os campos do complemento acima. Editar dados que vêm do Excel (título, programa, datas previstas, dotação) é outro mecanismo: esses valores alimentam filtros, ordenação e estado na base, por isso exigem uma revisão nova da oportunidade e voltam a aparecer como «alterados» numa reimportação.
3. Texto integral do PDF: continua por ler; só interessa se o resumo truncado não chegar.
4. Recolha manual (botão no Admin, proposta) ou agendada.
