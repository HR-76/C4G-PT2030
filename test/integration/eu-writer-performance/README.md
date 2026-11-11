# EU v2 — executores e prontidão HTTP

Contrato: `context/features/eu-writer-performance-executors.md`. Parâmetros herdados do protocolo v1, preservado em `context/references/performance/`; adaptações explícitas em `protocol.json` nesta pasta. Estado real e resultados pertencem à evidência externa de cada execução, nunca a comentários que certifiquem uma fonte futura.

## Versão e isolamento

`node scripts/prepare-eu-writer-trial.cjs --prepare` cria um bundle novo em `output/eu-writer-trial-<uuid>/`: fontes, ZIP, manifesto externo e proveniência. Deriva exclusivamente os bytes da baseline d289, os dois overlays tenant034 fixados, a correção do diretório de responsáveis para o port fechado de autoridade, os 16 inputs auxiliares públicos e os executores/testes deste incremento. As restantes alterações paralelas do workspace não são incorporadas. O preparador não executa SQL nem cria infraestrutura.

`node scripts/verify-eu-writer-trial.cjs --manifest <bundle>/trial.json` verifica ZIP/conteúdos, fontes, derivações e pacote. Os executores verificam também a raiz real em que correm e as versões das dependências instaladas; ficheiros executáveis extra não inventariados são recusados. As dependências não são arquivadas: instalar pelos três lockfiles ou reutilizar os três diretórios `node_modules` correspondentes através de junctions explícitas na cópia de fontes. Não copiar `.env` reais. O template público `.env.example` é apenas input fixado de testes.

Os comandos seguintes usam **o script dentro de `<bundle>/sources`**, não uma mistura de fontes do workspace corrente. `--tls-dir` identifica apenas os três certificados de laboratório já existentes (`localhost.crt`, `localhost.key`, `mkcert-rootCA.pem`); não se altera a trust store nem se arquiva a chave TLS. A disponibilidade de Chrome local e das imagens PG18/Keycloak indicadas é verificada pelo ensaio. Imagens são resolvidas para IDs locais imutáveis e registadas antes da execução; não há pull.

## Prova funcional autorizada neste incremento

```powershell
node <bundle>/sources/test/integration/eu-writer-performance/run.cjs --isolated --readiness --manifest <bundle>/trial.json --tls-dir <workspace>/.tmp/f2-integration
```

Cria recursos próprios, primeiro043 e depois042, em instalações independentes; usa apenas portas loopback, dados sintéticos e roles atuais limitadas. Não acede às bases habituais nem suspende serviços. O writer permanece inativo. O modo funcional M usa oito checkpoints por revisão, sem as séries de amostras de desempenho; valida igualdade, contagens e frescura. A prova de drift é separada e restaura/revalida os objetos da fixture.

Em043, executa HTTP/OIDC/PKCE com composição real: duas memberships, report, catálogo privado, dashboard, paginação assinada e cursores adulterados, recusas entre tenants e anónimos. Os pedidos são sequenciais. Dados de negócio têm IDs/datas determinísticos, 1000 candidaturas e 250 pessoas por tenant; credenciais, nomes físicos das bases e epochs de sessão são efémeros e não entram no seed lógico. O plano de seed é fixado por hash. As medições observacionais nesta fase servem para confirmar cobertura/drenagem, sem quantis de capacidade ou promessa de latência.

O relatório novo fica em `<bundle>/evidence/<uuid>/report.json`, ligado aos relatórios de etapa por hash. Só existe PASS com fontes estáveis, controlos funcionais satisfeitos e cleanup. Cleanup confere ID, nome, label e bindings locais antes de remover exclusivamente contentores próprios. Uma falha preserva a evidência e impede aprovação.

## Executores de medição preparados para uma execução posterior

Exigem um relatório funcional PASS para os mesmos hashes de fontes/manifesto, imagens e seed. O pedido atual não executa estes modos.

```powershell
node <bundle>/sources/test/integration/eu-writer-performance/run.cjs --isolated --measure-metadata --manifest <bundle>/trial.json --tls-dir <workspace>/.tmp/f2-integration --readiness-report <bundle>/evidence/<uuid>/report.json
node <bundle>/sources/test/integration/eu-writer-performance/run.cjs --isolated --measure-http --manifest <bundle>/trial.json --tls-dir <workspace>/.tmp/f2-integration --readiness-report <bundle>/evidence/<uuid>/report.json
```

M:042 e043 separados, seis pares alternados M7/M1, dez aquecimentos e cem chamadas por bloco; 600 amostras por variante/revisão. Uma aquisição de ligação por bloco, medida separadamente. Erros e chamadas de segurança são preservados; drift funcional fica fora da população cronometrada.

H: três fixtures independentes, matriz reportC1/C2/C4 e dashboardC1/C4/dois tenants; 108 tentativas medidas e 21 aquecimentos identificados. A prova funcional antecede a carga em cada fixture e não entra nos quantis. Tentativas falhadas permanecem no relatório. p50/p95 nearest-rank dos HTTP200 com contagem explícita; distribuição de todas as tentativas separada. Métricas ausentes/incompletas, erros, ausência de drenagem ou cleanup impedem PASS. Instrumentação preserva promises/callbacks/erros, regista SQL só por digest/categoria e calcula união temporal para intervalos sobrepostos; somas do driver não representam CPU SQL.

A normalização da resposta remove apenas `asOf`/`generatedAt` e projeta cursores devolvidos para `{position,context}`, omitindo validade temporal e assinatura. Não é um verificador de assinatura: o percurso HTTP valida página2 e recusa adulteração antes da medição. Campos de negócio permanecem no digest. Nenhum token, cookie, credencial ou resposta pessoal é guardado.

W continua opcional e desativado; C6 exige um candidato concreto e âmbito próprio. Este incremento não altera SLOs, pools, limites de autorização nem timeouts do produto. A prova histórica do writer mantém a sua identidade original e não certifica automaticamente os três overlays nem os executores novos.
