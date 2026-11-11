# Comparação da consulta completa

`confirm.ps1 -Report <nome-novo>` cria PostgreSQL 18 descartável com porta aleatória publicada apenas em 127.0.0.1. Não lê `.env`, runtime local, credenciais habituais ou dados reais. Usa o instalador de tenants e as migrações da fixture `http-oidc/fixture`, com identidade sintética sem contactar Keycloak. Remove apenas o contentor com o nome/label UUID desta execução. A imagem deve existir; não há download nem instalação de pacotes.

O runner executa o SQL capturado de `createSqlBrowse` sob a role funcional e o contexto RLS da organização. A referência A reconstrói o join temporal original, confere igualdade com o SQL guardado no primeiro diagnóstico e usa JIT ligado. B usa o SQL atual e JIT desligado apenas na transação, como a entrada produtiva de browse. A/B/B/A repetido duas vezes em cada cenário. Cada execução verifica igualdade exata dos resultados JSONB e fingerprints; os tempos SQL incluem compilação JIT, mas excluem o pedido HTTP, autenticação, coordenação de autoridade e ida/volta do comando SET LOCAL.

Volumes: 1 000 e 10 000 candidaturas, com origens privadas, centrais históricas v1 e canónicas v2. Cenários: primeira página, página profunda, pesquisa, estado, ordenação por prazo, ausência de unidade, equipa com dez membros associados, equipa vazia e negação por recurso. Duas bases tenant. Fixture e índices são sintéticos; não inferir capacidade de produção nem p95 a partir de quatro amostras por variante.

Verificações complementares: 28 comparações temporais UTC/Lisboa; cursores assinados; adulteração; mudança de ator, organização, filtros, permissões e dados fora da página; recusa da guarda; parâmetros/contexto cruzados sob RLS. Autoridade é fornecida sinteticamente: não se afirma uma nova prova de revogação central concorrente, OIDC, auditoria de commit ou latência do navegador.

Guarda fontes, hashes, versão/imagem, planos e resultados em `context/reviews/<nome>/`. Recusa sobrescrever relatórios. Se algum dos três ficheiros produtivos observados mudar durante o ensaio, termina FAILED e não certifica o estado final, preservando as medições e removendo os recursos próprios. Trabalho paralelo e carga da máquina podem afetar tempos; interpretar os intervalos e a comparação dentro da mesma execução.

Exemplo autorizado em 09/11/2026:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/application-browse-fingerprint/confirm.ps1 -Report browse-confirm-20261109
```
