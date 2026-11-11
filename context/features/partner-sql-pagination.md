# Paginação SQL de parceiros — contrato de compatibilidade e provas

Estado: Review — preparação de contrato e testes concluída, 27/10/2026. Pedido explícito do utilizador: preparar o contrato e os testes de equivalência, preservando ordenação, cursor, filtros e autorização. **Não implementar nem ativar o novo leitor SQL neste incremento.** [Resultado e evidência](../reviews/partner-sql-pagination-contract/README.md).

## Âmbito e fontes

Produto pretendido: parceiros e pessoas são informação privada da candidatura, sem contas, convites ou permissões próprias; [decisão vigente](organization-users-and-application-guests.md). Arquitetura aprovada: contexto e membership centrais, isolamento por organização e autoridade server-side. Baseline de implementação: [contrato HTTP](../references/application-partners-http.md), `backend/src/applications/partners.js`, composição e router de candidaturas, `pq1UiTokens.js` e cliente frontend.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; 2549 entradas no worktree inicial. Inventário anterior às edições: 30923 ficheiros, `%TEMP%/c4g-partner-pagination-contract-baseline-20261027.json`. Preservar os dois incrementos anteriores e todo o trabalho não relacionado.

Este incremento pode criar testes, suporte de testes e documentação. Não altera runtime, frontend, dependências, migrations, grants/permissões, dados/configuração Dev, serviços, deploy ou Git. Não executar o harness SQL existente, pois carrega configuração de infraestrutura; testes locais usam apenas dados sintéticos, doubles e, se necessário, HTTP efémero em loopback.

## Contrato a preservar

### C1 — Fronteira HTTP e input

- Apenas a consulta transversal `GET /api/applications/partners` é alvo da futura otimização. Detalhe, histórico e mutações de parceiros ficam intactos.
- Parâmetros opcionais: `q`, `country`, `person_role`, `cursor`, todos strings. Sem `limit`, `sort`, `direction`, organização ou âmbito fornecido por query. Arrays, chaves desconhecidas e body GET não vazio são recusados.
- `q` é trimado, até 200 unidades UTF-16; país até 100, já trimado; ambos sem NUL. Papel vazio ou `RESPONSAVEL`, `INVESTIGADOR`, `OUTRO`. Cursor vazio equivale a ausência; máximo 4096 caracteres.
- Resposta de sucesso 200: `{items,total,page,nextCursor,previousCursor,countries}`; máximo 25 itens, sem adicionar `pageSize`. Página vazia continua 200. `Cache-Control: no-store`.
- Preservar 400 `INVALID_INPUT`/`INVALID_CURSOR`, 409 `SCHEMA_UPGRADE_REQUIRED`/`LIMIT_EXCEEDED`, erros de sessão/contexto/autoridade existentes e 503 `SERVICE_UNAVAILABLE` sanitizado. Correlação e envelope existentes não migram para RFC 9457 neste incremento.
- `X-C4G-Organization` apenas confirma o contexto capturado; não escolhe ligação nem concede acesso. Sessão, membership, contexto inválido e header divergente conservam a recusa atual. Router com doubles não prova OIDC nem a composição completa.

### C2 — Seleção e autorização

- Considerar apenas associações ativas, na organização resolvida no servidor, com joins também ligados à organização. Dados de outra organização nunca entram na página, total, países ou digest.
- Guard global `APPLICATION_READ` antes da leitura de schema/dados. Schema ausente falha; não devolver lista vazia como fallback.
- Percorrer candidatos por `partner_id` crescente. Por candidato: `APPLICATION_READ` da candidatura, depois `OPPORTUNITY_READ` da oportunidade privada ou da organização se não existir ID privado, depois `F14_PREQUALIFICATION_READ` se houver avaliação. Preservar short-circuit e erro propagado.
- Autorizar antes de aplicar país, papel ou pesquisa. Recusa funcional exclui a associação; autoridade/auditoria indisponível ou stale falha fechada, sem resultados parciais. Preservar a precedência destas falhas sobre a validação do cursor.
- A composição já reutiliza decisões por operação/recurso dentro do pedido, validando o guard em hits. Não transformar chamadas ao port em contagens de SQL, não alargar a duração da cache, nem substituir a autoridade por predicados SQL inferidos.
- Manter limite de 10000 candidatos ativos examinados, mesmo se recusados ou fora dos filtros; 10001 falha sem autorizar o candidato excedente. Sem truncagem silenciosa.

### C3 — Projeção, filtros e países

- Ficha devolvida: ID, campos do body atual, apenas pessoas ativas na ordem persistida, `createdAt`/`updatedAt` ISO; acrescenta `application_id`, `application_title`, `application_status`, `opportunity_title`. Preservar null/vazio, nomes e tipos. Não substituir ficha por resumo sem decisão de contrato.
- Título da oportunidade segue a expressão atual `COALESCE(a.central_snapshot->>'title',o.title)`, incluindo a distinção entre vazio e NULL. Dados de candidatura/oportunidade são os observados no join do respetivo candidato; fixtures já projetadas não provam a execução desse join em PostgreSQL.
- `country` usa igualdade exata, sensível a maiúsculas/acentos; vazio significa todos. `person_role` exige uma pessoa ativa com esse papel.
- `q` usa substring literal após `toLocaleLowerCase('pt')`; `%`, `_`, apóstrofo e barra invertida não são wildcards. Não remover acentos nem normalizar silenciosamente Unicode.
- Campos pesquisados: entidade, país, área/interesse, responsável, contacto/email; nome, área, contacto/email de todas as pessoas ativas. Não pesquisar títulos de candidatura/oportunidade, estado ou nome do papel.
- Papel e pesquisa podem casar pessoas diferentes na mesma associação. Não os fundir num JOIN que exija a mesma pessoa.
- `countries` deriva de **todos os autorizados antes dos filtros**; exclui vazio, deduplica por igualdade exata e ordena com comparação portuguesa. Pode mudar sem mudar a página filtrada.

### C4 — Ordenação e navegação

- Ordem das associações: `entity_name.localeCompare(other,'pt')`, seguido de `id.localeCompare(otherId)` para desempate. Ordem dos países: `localeCompare('pt')`; não deduplicar valores apenas por equivalência de collation.
- 25 itens por página, total exato dos matches autorizados; próxima/anterior, primeira/última e conjunto vazio conservam o comportamento atual, sem saltos ou duplicados num dataset estável.
- Collation/lower/canonicalização PostgreSQL não são assumidos equivalentes aos de Node/ICU. Fixar versões usadas e provar corpus com acentos, caixa, pontuação e caracteres astrais antes da substituição. `browseSql.js` de candidaturas não é um leitor equivalente de parceiros.

### C5 — Cursores compatíveis

- Conservar assinatura/purpose `F13_PQ1_UI_CURSOR_V1`, key ring, expiração de 600 segundos e route `partners-browse`; aceitar cursores emitidos pelo leitor atual durante a janela de validade. Não introduzir route v2 ou fingerprint JSONB silenciosamente.
- Binding exato: organização, subject, route, `q` depois do trim (preserva caixa), país e papel. Alterar caixa de q pode manter resultados mas invalida o cursor anterior; espaços exteriores de q não alteram o binding.
- Posição `{offset,digest}`: offset inteiro seguro, não negativo e múltiplo de 25. Cursor adulterado, expirado, com binding errado, offset inválido ou digest diferente falha com `INVALID_CURSOR`.
- Digest SHA-256 dos bytes da lista canónica de **todas as projeções filtradas, na ordem final**, incluindo pessoas ativas, timestamps e campos da candidatura/oportunidade. Não apenas IDs/revisões nem só a página. Preservar canonicalização NFC estrita e limites por registo sem reintroduzir 256 KiB para a lista inteira.
- Alteração de um match fora da página também invalida. Adição/remoção/recusa de um match invalida; alterações em registos recusados/inativos/de outra organização ou autorizados fora do filtro não invalidam se a lista filtrada não mudar. Países podem mudar nesse último caso.
- Cursor válido não é autorização: cada pedido volta a passar pela autoridade. Cursor só é aberto depois de guard, schema, exame de candidatos, autorização, projeção/filtros e digest. Não antecipar a validação se isso alterar a precedência de falhas/auditoria.
- Evidência de compatibilidade, não novo requisito de produto: um offset corretamente assinado além do total é atualmente aceite, com página vazia e anterior aritmética. Não apertar esse comportamento incidental durante esta substituição; eventual alteração deve ser decidida separadamente.

### C6 — Concorrência e consistência

- Mutações continuam fora deste âmbito; não alterar CAS, idempotência, histórico, F7 ou isolamento.
- Entre pedidos, alterações de projeção/visibilidade são detetadas segundo C5. Preparar testes de atualização/remoção/inserção e revogação entre páginas, incluindo mudanças fora da página.
- O leitor atual usa várias consultas e o BEGIN não fixa explicitamente o isolamento; sob READ COMMITTED não oferece snapshot global repetível entre blocos. O gate deve confirmar o isolamento efetivo. Não prometer equivalência de todos os interleavings a uma consulta única. O novo desenho deve documentar os seus pontos de observação e provar que página, total, países e digest não misturam duas versões silenciosamente.
- Uma estratégia metadata→hidratação deve demonstrar coerência perante alterações do body/timestamps/candidatura entre as duas consultas; parceiros são mutáveis, ao contrário do conteúdo de alertas do incremento anterior. Não introduzir REPEATABLE READ, locks, revalidação adicional ou retries sem avaliar impacto no protocolo de autoridade e registar a decisão.

## Critérios de aceitação deste incremento de preparação

| Critério | Evidência requerida |
| --- | --- |
| P1 | Contrato C1–C6 explícito e distinguindo comportamento atual, produto e desenho SQL ainda não implementado |
| P2 | Suite reutilizável de comportamento do leitor com expectativas independentes, dados sintéticos e adapter atual; sem alegar equivalência SQL antes de existir candidato |
| P3 | Casos de ordenação/desempate, filtros literais/combinados, pessoas ativas, países globais e navegação completa |
| P4 | Cursores reais assinados: bindings/expiração/adulteração, digest do conjunto filtrado inteiro, alterações e revogação entre páginas |
| P5 | Guard/short-circuit/precedência de erros, limites, isolamento do contrato do repositório e erros HTTP sanitizados; limites dos doubles declarados |
| P6 | Testes negativos de sensibilidade: um candidato deliberadamente errado deve ser detetado pelo contrato; não criar testes que apenas repetem a implementação |
| P7 | Testes focados, suite backend/frontend e build, sintaxe dos testes; falhas anteriores/novas e skips separados; fontes protegidas e worktree preservados |

## Plano da implementação SQL (sem integração)

Desenho solicitado e concluído em 27/10/2026: [adaptador candidato compatível](../research/partner-sql-adapter-design.md), em Review como recomendação. Portal `NO SCROLL WITHOUT HOLD` fixa a seleção, mantendo comparadores, filtros, digest e autoridade atuais em Node. Não é paginação SQL integral; memória/trabalho globais permanecem. A mudança temporal proposta e os gates de snapshot/cleanup/capacidade estão explícitos. Nenhum candidato executável foi integrado nem houve alteração de arquitetura aprovada implicitamente.

1. Usar os cenários e expectativas deste incremento como porta de aceitação para um segundo adapter. [Protótipo separado](partner-portal-prototype.md) implementado em 27/10/2026 e validado com os mesmos 16 cenários em doubles. Isto ainda não prova execução PostgreSQL ou RLS.
2. Resolver os gates técnicos de C2/C4/C5/C6: equivalência Node/ICU↔PostgreSQL, digest legado exato, autoridade/auditoria e coerência das leituras. Não selecionar collation, cursor v2 ou snapshot alternativo por inferência silenciosa.
3. Desenho e protótipo do menor leitor candidato concluídos, fora do runtime ativo. API e autoridade preservadas nos testes com doubles; candidatos/metadados ainda O(N), sem eliminação de conteúdo materializado. Um LIMIT 25 isolado não satisfaz o contrato; integração continua pendente.
4. Num ambiente PostgreSQL descartável explicitamente autorizado, executar a mesma matriz com duas organizações, roles reais/RLS, grants por recurso/equipa, indisponibilidade/revogação e escritor concorrente. Preparar/aplicar SQL/grants só dentro dessa autorização; nunca Dev.
5. Comparar baseline e candidato: páginas completas, digests/cursores emitidos e aceites nos dois sentidos com clock/key fixados, total/países, erros e rastos de autoridade/auditoria. Não comparar só IDs da primeira página.
6. Medir 0/25/26/100/101/10000/10001 candidatos, seletividade, origem partilhada e payloads grandes: queries por camada, linhas/bytes materializados, memória, latência e planos PostgreSQL. Registar ambiente/versões e falhas; não enfraquecer SLO, autoridade ou limites.
7. Só depois substituir o caminho atual em alteração pequena, com suites/build e prova de compatibilidade de cursores. Índices, migrations, permissões e rollout são decisões separadas que requerem autorização explícita.

## Validação

25 novos testes: 16 cenários reutilizáveis C2–C6, três controlos negativos e seis testes HTTP C1. Foco conjunto 31/31 PASS; backend 1369 PASS/0 FAIL/7 SKIP; frontend 346 PASS/build PASS; sintaxe de quatro ficheiros PASS. Revisão independente concluída. Nenhuma mudança de runtime; estes são testes de caracterização, não prova de um candidato SQL já implementado.

Os casos de dados malformados pressupõem que a fixture consegue preparar a row antes de chamar browse. Se PostgreSQL recusar um valor logo na preparação (por exemplo, surrogate isolado), a futura prova deve distinguir essa rejeição de armazenamento do teste de leitura, documentando a evidência correspondente; não marcar um caso não executado como PASS. Esta limitação não afeta a caracterização atual.

Resultados, ficheiros e preservação em `context/reviews/partner-sql-pagination-contract/README.md`. A preparação fica em Review; a implementação SQL não fica Ready enquanto os gates técnicos acima estiverem por resolver.
