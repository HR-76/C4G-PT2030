# Gate HTTP/OIDC isolado

Na raiz, com Docker Desktop, Node e as dependências já instaladas:

O gate também prova renovação idle sem mudar auth, expiração física ou epochs, recusa SQL de mutações críticas sem permissão, expiração e prevenção de ressurreição de SID. As fronteiras temporais usam sessões sintéticas separadas com relógio controlado e o adaptador/roles SQL reais; essas sessões não participam no login HTTP nem no benchmark, que continuam a usar OIDC real. O dashboard integra a medição e deve recusar uma membership revogada. `-Report` escolhe uma pasta simples dentro de `context/reviews/`, preservando a evidência anterior.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-oidc/gate.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-oidc/gate.ps1 -Scope revocation
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-oidc/gate.ps1 -Samples 12 -Report http-session-epochs
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-oidc/gate.ps1 -Scope sessions -Report http-session-epochs
```

Pré-requisitos existentes: Chrome em `C:/Program Files/Google/Chrome/Application/chrome.exe`, Playwright de `frontend/test-harness`, certificados locais de teste em `.tmp/f2-integration/` (`localhost.crt`, `localhost.key`, `mkcert-rootCA.pem`). O gate não instala certificados nem altera a confiança TLS. Usa PostgreSQL 17 Alpine e Keycloak 26.8.0, portas de loopback livres e contentores exclusivos, identificados por UUID/label. O cleanup verifica essa propriedade antes de remover apenas esses contentores/volumes. Nunca usa as portas Dev 5432/5433.

Os manifests existentes são aplicados integralmente a uma base central e duas bases tenant novas. O provisionador e diretório centrais são reais. Os logins da API usam o perfil de capabilities existente, a autoridade usa `c4g_authority_runtime`, e o catálogo usa um login dedicado de `c4g_catalog_reader`. Só o bootstrap e as fixtures usam a ligação de instalação. O leitor central não coordenado usa `pg_read_all_data`, como nos gates anteriores: isto limita a alegação de paridade com privilégios produtivos centrais.

O login passa pelo Keycloak via Authorization Code/PKCE, com TLS verificado. O gate carrega o Axios e `AuthProvider` reais por um bundle de teste em memória. Não fabrica cookies/sessões nem substitui autorização, SQL ou RLS por doubles. As falhas de revalidação GET, CSRF e resposta pendurada são injeções explícitas de teste. A resposta pendurada é retida depois do handler real da sessão; não representa uma query SQL infinita. A revogação concorrente usa um lock PostgreSQL real, após resolução inicial de identidade, sem desativar validações.

`all` mede browse/report com 25/1000/10000 candidaturas, 12 amostras por percurso/volume, quatro pedidos concorrentes da mesma sessão, um aquecimento e uma sessão OIDC nova por volume. `-Samples` permite 4–100 amostras. O tempo HTTP inclui leitura do body e cliente Playwright; o login não integra p50/p95. São contadas chamadas de rede ao driver `pg`, incluindo transações, metadados e protocolo central. Não são contados os statements internos das funções PostgreSQL. O polling da autoridade varia sob concorrência, pelo que o total de chamadas não é uma constante. Verifica-se separadamente uma seleção de candidaturas e até 25 detalhes por página.

O cliente de medição usa timeout de 65 s para observar a resposta do servidor; isso não aumenta os timeouts do produto. As provas específicas de sessão usam o Axios real, com os seus limites existentes. Um aquecimento falhado é registado e impede lançar uma carga sem resultado útil nesse percurso. Quantis de sucesso excluem erros e identificam o número reduzido de sucessos. O gate devolve exit 1 perante falhas; nunca transforma timeouts/503 em amostras de latência bem-sucedida. A prova de matching com 25 pessoas verifica o lote real; não declara p95 de matching com 1000 pessoas.

Resultados sanitizados em `context/reviews/http-oidc-isolated/`: `results.json` para o recorte completo, `results-revocation.json` para o recorte de revogação, e `run-<uuid>.json` para histórico. Não guardar credenciais, cookies, tokens, URLs de ligação ou traces de login. O gate não testa R2, Resend, antivírus, import worker, MFA com OTP ou a topologia de produção. Dados e máquina locais não demonstram capacidade/SLO produtivos.
