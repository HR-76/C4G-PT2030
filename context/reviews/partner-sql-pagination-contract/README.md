# Parceiros — preparação da paginação SQL

Estado: Review — 27/10/2026. [Contrato C1–C6 e plano](../../features/partner-sql-pagination.md). Este incremento prepara a substituição do leitor; não implementa paginação SQL nem altera o runtime.

## Resultado e âmbito

O contrato fixa a fronteira HTTP, a projeção completa, a ordem portuguesa com desempate por ID, os filtros literais, os países calculados antes dos filtros, o cursor legado e o percurso de autoridade. Distingue a arquitetura multi-instituição aprovada do leitor atual e do futuro catálogo de parceiros reutilizáveis, que permanece fora deste âmbito.

A suite reutilizável em `backend/test/support/partnerBrowseContract.js` é executada contra o leitor atual pelo adapter `partnerBrowseReferenceHarness.js`. As expectativas de IDs/ordem/projeção são explícitas; um vetor canónico e cursor legado fixos verificam compatibilidade. O teste HTTP usa router Express e parser reais, com serviço/middleware simulados.

Não existe ainda um adapter SQL candidato. PASS nesta preparação caracteriza o baseline e demonstra sensibilidade a desvios concretos; não constitui equivalência PostgreSQL, prova de RLS ou aprovação de capacidade.

## Nuances protegidas

- `countries` considera todos os autorizados antes de país/papel/pesquisa. Uma pesquisa sem resultados pode conservar países disponíveis.
- O digest abrange todas as projeções filtradas/ordenadas, incluindo conteúdo fora da página visível. Alterações fora do filtro podem mudar países sem invalidar o cursor.
- Pesquisa é substring literal com caixa portuguesa; `%`, `_` e barra invertida não são wildcards. Acentos são significativos. Papel e pesquisa podem casar pessoas diferentes.
- A autorização de candidatura, oportunidade e avaliação precede os filtros; há short-circuit e precedência de falhas sobre cursor inválido. O limite de 10000 conta candidatos brutos, mesmo recusados ou fora dos filtros.
- Cursor permanece assinado, ligado ao utilizador/organização/route/filtros e válido durante 600 segundos. Preservar caixa de q no binding, depois do trim. Não trocar por fingerprint SQL ou route v2.
- O leitor atual não oferece snapshot global sob READ COMMITTED. A coerência de uma eventual seleção seguida de hidratação de corpos mutáveis exige uma prova separada.

## Matriz de verificação

| Contrato | Prova local | Limite / gate futuro |
| --- | --- | --- |
| C1 HTTP/input | `partnerPaginationHttpContract.test.js`: shape, 200 vazio, no-store, strings/limites/papéis, body GET, métodos e erros sanitizados | Middleware/service doubles não provam OIDC, membership nem binding real do header |
| C2 autorização/limites | Cenários do repositório: guard, âmbito dos recursos, ordem/short-circuit, falhas antes do cursor, candidatos recusados/inativos/estrangeiros e 10000/10001 | RLS, grants, equipa, revalidação final, cache real e auditoria exigem composição/DB isoladas |
| C3 filtros/projeção | Campos permitidos, literais, caixa/acentos, pessoas ativas, combinação de papéis, null/vazio e países globais | Rows de fixture já contêm dados do join; não provam execução SQL do join nem seu plano |
| C4 ordenação/páginas | Corpus explícito de 67 associações, empates, três páginas e navegação inversa; fronteiras vazio/25/26 | Corpus não prova equivalência universal Node/ICU↔collation PostgreSQL |
| C5 cursor/digest | Assinatura e clock reais sintéticos, vetor legado, bindings, expiração, posições, mudança de match fora da página e mudanças excluídas | Validar compatibilidade nos dois sentidos com o candidato SQL e key ring de teste |
| C6 concorrência | Alterações e recusas entre pedidos, sem threads/DB reais | Escritor concorrente entre statements, locks e transações permanecem por provar |
| Sensibilidade | Controlos negativos: países da página, ordem invertida e aceitação indevida de cursor stale | Deteta esses desvios; não é prova exaustiva de todos os erros possíveis |

O SQL double do adapter atual valida os predicados e parâmetros de âmbito antes de selecionar rows sintéticas. Os cenários reutilizáveis não inspecionam SQL nem exigem que o futuro adapter reproduza os batches físicos do double. Chamadas ao port de autorização não são contagens de queries Central: a composição existente já reutiliza decisões por recurso dentro do pedido.

## Execução e futuro adapter

Na pasta `backend/`:

```powershell
node --test test/partnerPaginationContract.test.js test/partnerPaginationHttpContract.test.js test/applicationPartners.test.js test/partnerBrowseBoundary.test.js
```

O futuro adapter deve fornecer o mesmo protocolo de fixture com operações assíncronas e cleanup, carregando os dados sintéticos em infraestrutura isolada autorizada. Registar cada cenário exportado de `CASES` com `scenario.run(createSqlHarness)`; manter as expectativas e o cursor legado independentes do candidato. Não adaptar o oracle para fazer passar uma divergência. O caso de dados malformados pressupõe que a fixture os consegue preparar antes de browse: se PostgreSQL recusar um valor na própria preparação, como um surrogate isolado, separar/documentar a rejeição de armazenamento e a prova de leitura. Não converter um caso não executado num PASS.

Antes de ativar o leitor SQL, comparar respostas completas, cursores/digests, total/países, códigos de erro e rastos de autoridade/auditoria. Gates de collation, canonicalização, concorrência e medição estão no plano do contrato. O harness PostgreSQL já existente no repositório não foi executado: usa configuração de infraestrutura e não implica autorização para Dev ou SQL de preparação.

## Validação desta preparação

**25 testes novos:** 16 cenários reutilizáveis C2–C6, três controlos negativos e seis testes HTTP C1. Os seis testes de parceiros já existentes passaram antes de adicionar os novos casos.

| Verificação | Baseline | Resultado final |
| --- | --- | --- |
| Foco parceiros | 6/6 existentes | **31/31 PASS** |
| Backend `npm test` | 1344 PASS/0 FAIL/7 SKIP, incremento anterior | **1369 PASS/0 FAIL/7 SKIP**, total 1376 |
| Frontend `npm test` | 346 PASS | **346 PASS**, 55 ficheiros |
| Frontend `npm run build` | PASS anterior | **PASS** |
| `node --check` | — | **PASS**, quatro ficheiros novos |

Os sete skips de infraestrutura mantêm-se; nenhum gate foi ativado nem substituído por mocks para declarar PASS. Não havia falhas de runtime pendentes na baseline. Durante a preparação foi corrigida uma ambiguidade de fixture: a pesquisa sem acento encontrava um email, pelo que esse email passou a ser distinto do nome pesquisado. O primeiro cálculo auxiliar do vetor via pipeline ASCII foi descartado; o valor final preserva Unicode e foi confirmado por dois cálculos independentes, sem usar saída do leitor. Estas eram questões dos dados/oracle de teste, não regressões ou alterações ao runtime.

A revisão independente confirmou contrato e cobertura; incorporou verificação do tipo/âmbito dos recursos e token legado independente. O cenário de binding conserva as mesmas projeções/digest ao trocar filtros, subject ou organização, evitando que uma recusa incidental por digest esconda falha de binding. Os três candidatos deliberadamente incorretos são detetados por asserções dos cenários.

Vetor golden: 26 projeções, **15289 bytes UTF-8**, SHA-256 `ac97db797317226f80c125e8770f8250ae6432b8333f0a565fe1eb7273361e21`. O token fixo é exclusivamente sintético, com clock/chave conhecidos dos testes; não contém credenciais de aplicação.

Logs locais: `%TEMP%/c4g-partner-pagination-final-focused.log`, `%TEMP%/c4g-partner-pagination-contract-backend.log`, `%TEMP%/c4g-partner-pagination-contract-frontend.log` e `%TEMP%/c4g-partner-pagination-contract-build.log`. Resumo e preservação em [verification.json](verification.json).

Ambiente do corpus: Node **v24.13.1**, ICU **78.2**, CLDR **48.0**, Unicode **17.0**. `Intl.Collator('pt')`: sensitivity variant, collation default, numeric false, ignorePunctuation false. Alterar a versão/corpus exige rever compatibilidade; não regenerar expectativas a partir do leitor.

Não há medição antes/depois de desempenho aplicável: o runtime não mudou. Os cenários grandes verificam comportamento e limites; a duração dos testes não é benchmark. O plano futuro exige queries por camada, linhas/bytes materializados, memória, latência e planos SQL em ambiente identificado.

## Preservação

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline de 2549 entradas Git e 30923 ficheiros em `%TEMP%/c4g-partner-pagination-contract-baseline-20261027.json`. Foram também registados hashes de oito fontes relevantes, antes das alterações.

Ficheiros deste incremento:

- `backend/test/partnerPaginationContract.test.js` e `backend/test/partnerPaginationHttpContract.test.js`.
- `backend/test/support/partnerBrowseContract.js` e `backend/test/support/partnerBrowseReferenceHarness.js`.
- `context/features/partner-sql-pagination.md`, `context/current-work.md`, este relatório e `verification.json`.

Build/cache frontend são artefactos esperados da validação. Nenhuma alteração de migrations, permissões, dados/configuração Dev, dependências ou runtime; sem deploy ou operações Git mutáveis. A conferência usa metadados do worktree e hashes de oito fontes relevantes; não representa snapshot de dados externos. Detalhes em `verification.json`.

**Próximo passo:** desenhar o adapter SQL candidato, resolvendo collation, digest legado e consistência das leituras antes de o ligar ao runtime.
