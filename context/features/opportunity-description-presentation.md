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

## 3. Complemento da oportunidade e edição pelo Admin — Review

Migração autorizada pelo utilizador em 14/11/2026 («Sim, autorizo»), medida primeiro num PostgreSQL descartável.

### Contrato

- Complemento guardado ao lado da oportunidade, por `opportunity_id`, fora da revisão canónica: nenhuma revisão, digest ou reimportação muda. Duas camadas: `COLLECTED` (o que a fonte pública publica, com URL e data de observação) e `EDITORIAL` (o que o Admin C4G escreveu, com autor e data). Histórico só de acrescento.
- Na leitura, o valor do Admin prevalece campo a campo; cada campo indica a origem. Uma nova recolha nunca apaga nem altera o que o Admin escreveu. Gravar um campo vazio devolve o valor recolhido.
- Campos: descrição, página oficial do aviso, código do aviso, prioridades, tipologias de ação, de intervenção e de operação, taxa de comparticipação.
- Serve qualquer oportunidade do catálogo (PT2030, EU ou manual). A recolha automática só existe para `PORTUGAL2030_PLAN`, ligada pelo ID do plano.
- Edição e recolha só por `C4G_ADMIN`: a função de escrita na base confirma a sessão ativa e o papel em cada escrita, com bloqueio contra revogação concorrente. Idempotente por pedido; recusa versão desatualizada. O autor e a data ficam no próprio histórico; não é emitido evento na cadeia de auditoria e não é exigida autenticação recente (igual aos templates de email).
- Recolha desligada por omissão. `OPPORTUNITY_COMPLEMENT_COLLECTION=facts` copia a página do aviso, código, prioridade, tipologias e taxa; `facts-and-summary` copia também o resumo. Só é escrito o que mudou.
- Ficha: a descrição indica a origem («Texto redigido pela C4G» ou «Resumo [parcial] publicado em portugal2030.pt», com ligação), «Consultar fonte oficial» passa a apontar para a página do aviso e aparece a secção «Informação complementar». Admin C4G: botão «Editar informação» na ficha e «Atualizar dados PT2030» na lista.

### Implementação

- Central `053_opportunity_complement` (`backend/database/central/candidates/opportunity_complement.up.sql`, pacote `opportunity-complement-v1`), a seguir à 052, irreversível. Tabela `public.opportunity_complement_version` e função `public.opportunity_complement_write`; nada é criado, alterado ou concedido em `opportunity_catalog`, e o leitor restrito do catálogo não recebe acesso. Sem chave estrangeira para a oportunidade (para não tocar no esquema do catálogo): o serviço confirma que existe antes de escrever.
- Versões conhecidas atualizadas: manifesto, executor e preflight da Central, preflight de oportunidades, leitor do catálogo (esquema e segurança), PDFs de faturação, carregamento PT2030, contrato do ledger do catálogo, instalador de staging e admissão da variante de staging (pins próprios da 053).
- Modelo e validação em `opportunities/complement.js`; serviço e rotas em `opportunities/complementService.js` (`GET`/`PUT /api/admin/opportunity-complements/:id`, `POST /api/admin/opportunity-complements/collections/portugal2030`); leitor do site em `portugal2030/noticeSite.js`. O detalhe da oportunidade (`/api/central-opportunities/:id` e a variante de administração) inclui `complement`; numa Central ainda sem a 053 o detalhe responde sem complemento.
- Frontend: `OpportunityComplementEditor.jsx`, `opportunityFirstAnalysis.js`, `OpportunityReadModelView.jsx`, `CentralOpportunities.jsx`.

### Validação (14/11/2026)

- Gate isolado `node test/integration/opportunity-complement/gate.cjs` (PostgreSQL 18 próprio em `.tmp`, sem ligação a bases existentes), aprovado nas duas variantes: genérica e com os logins de runtime do staging (`COMPLEMENT_GATE_STAGING_LOGINS=1`). A variante de staging reproduz primeiro os pins da 052 fixados na VPS. Prova: aplicação pelo pacote registado, repetição sem efeito, preflight da Central, preflight de oportunidades e admissão do leitor na 053; privilégios; fronteira de escrita (não administrador, sessão expirada, versão desatualizada, repetição, conflito, dois escritores concorrentes, histórico imutável); serviço completo (edição, recolha `facts` e `facts-and-summary`, precedência do Admin, fonte indisponível).
- Backend 3264 aprovados, 9 ignorados, 0 falhas. Frontend 1088 aprovados e 1 falha por tempo limite já conhecida em `ApplicationPartners` (passa isolado). Lint e build aprovados.
- Não feito: browser; aplicação a qualquer base habitual; recolha real contra portugal2030.pt pelo código (só leitura manual no browser durante a investigação).

### Limites

- Com a ligação da API pelo login limitado `c4g_central_runtime` (hoje desligada no staging), o serviço não consegue confirmar a oportunidade em `opportunity_catalog`; a edição responderia 503. Fica para o perfil de runtime completo.
- O leitor experimental `catalogRead` (modo controlado) só conhece a Central até à 051; já não admitia a 052.
- A API do site não é um serviço documentado: uma mudança de formato faz a recolha falhar ou ignorar itens, sem alterar o que está guardado.

### Perguntas em aberto

1. **Termos do site.** Os Termos e Condições de portugal2030.pt dizem que o conteúdo «não poderá ser copiado, alterado ou distribuído, salvo com autorização expressa da Agência, I.P.», com exceção do direito de citação com origem identificada. `robots.txt` não restringe. **Decidido pelo utilizador em 14/11/2026: só dados factuais (`facts`).** A descrição dos avisos PT2030 fica para o Admin C4G escrever; o resumo do site não é copiado. O modo é uma variável do ambiente e mantém-se quando as variáveis de staging são regeneradas.
2. **«Outros dados» editáveis.** Implementado: os campos do complemento. Editar dados que vêm da fonte (título, programa, datas previstas, dotação) é outro mecanismo: alimentam filtros, ordenação e estado, exigem uma revisão nova da oportunidade e voltam a aparecer como «alterados» numa reimportação.
3. Texto integral do PDF da ficha resumo: por ler; só interessa se o resumo truncado não chegar.
