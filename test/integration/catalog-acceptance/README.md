# Aceitação do catálogo — exclusivamente isolada

Este diretório não é importado pela APP. O ensaio não ativa fontes, jobs nem migrações habituais.

## OIDC e perfis

Na raiz GCNI, executar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/catalog-acceptance/run-oidc.ps1 -UiBuild <workspace>/work/catalog-ui-final-review/dist
```

Requer imagens PostgreSQL18/Keycloak26.8.0 já disponíveis, os certificados locais de ensaio existentes, Chrome e dependências do projeto. Não instala confiança TLS. Cada execução cria dois contentores com nomes e labels UUID; o finally verifica propriedade e remove apenas esses recursos. O browser não grava cookies, tokens nem traces de login. Relatórios sanitizados em context/reviews/catalog-read-acceptance-load/<UUID>/.

Antes do pacote candidato: usa a composição GCNI, Authorization Code/PKCE, TLS verificado, cookies Secure/HttpOnly e seleção de organização real. Perfis sintéticos: C4G_ADMIN com membership e empresa cliente CONTRIBUTOR. A atribuição global não substitui a membership. O callback pode selecionar automaticamente a única membership elegível, comportamento normal; o ensaio confirma a organização por POST. Não representa uma conta habitual ou federação externa.

Depois do pacote 046–048: executa preflight central sem alterações e tenta /api/auth/session e /api/catalog-read/v1/opportunities nos dois perfis. Uma recusa não é contornada nem convertida em sucesso. O router de leitura é inserido apenas pela factory Express do teste, depois do middleware de sessão existente e antes do 404. O código operacional não recebe rota nova.

## Carga independente

A partir do workspace:

```powershell
python <GCNI>/test/integration/catalog-read/run-isolated.py --isolated --workspace work --report work/catalog-load-results.json --load-acceptance
```

Cria PostgreSQL18 nativo próprio; 27 oportunidades de baseline e depois 10000. A fixture passa pelas constraints, approvals e roles normais, em lotes de 50. Não se desativam triggers. Páginas25, 10 pedidos HTTP concorrentes, 10 aquecimentos por cenário, cinco execuções de 10 pedidos por endpoint/volume. Pools catálogo e autoridade preservam max=2 do gate nativo; não são inferidos limites de produção.

Os tempos de servidor vão da entrada no middleware até emissão dos headers; incluem sessão, admissão e serialização, mas excluem transferência externa. O tempo cliente inclui resposta JSON. p95 usa nearest rank. Todas as amostras e erros são guardados. Aquecimento falhado muda o cenário para REJECTION_DIAGNOSTIC: a recusa pode ser observada, mas não é capacidade útil nem PASS de latência.

Orçamento do launcher: 900s neste modo, separado do timeout do produto. Não executar com --ui-review. O cluster é parado no finally. O perfil usa sessões sintéticas assinadas para isolar desempenho; não substitui a prova OIDC. Comparar volumes não é uma comparação entre versões de código. O alvo de 500ms é o desenho G1, não SLA aprovado.

## Revisão e saída

Exit não zero é esperado quando a aceitação falha; ler results.json e cleanup.json. Não elevar o limite de64MiB, alterar fingerprints/manifests, desativar autorização ou aceitar migrações desconhecidas para obter PASS. Os relatórios distinguem autenticação, integração, carga útil, diagnóstico de recusa e encerramento de recursos.

A ausência futura da recusa de admissão devolve INCOMPLETE_FUNCTIONAL_ACCEPTANCE até adicionar/executar tabela/ficha, negação entre organizações e revogação com essas sessões OIDC. Este gate de diagnóstico não pode certificar esses percursos por inferência.
