# Executores de desempenho EU v2 e prontidão HTTP

31/10/2026 — pedido confirmado: adaptar os executores, preparar uma versão de ensaio com a correção tenant034 e comprovar o funcionamento HTTP antes da carga. Continuação da consolidação `eu-writer-v2-d2898861a25b4f6e` e do protocolo `eu-writer-v2-performance-2026-10-31-v1`.

## Âmbito

Implementar os executores obrigatórios M (metadados042/043) e H (report/dashboard), uma composição de laboratório atualizada e uma prova funcional HTTP/OIDC. Conservar a baseline original e os seus protocolos; criar uma versão derivada com proveniência, hashes e diferenças explícitas. Incorporar a correção já implementada de admissão tenant034, sem absorver silenciosamente a preparação paralela da janela habitual043.

Dependência encontrada na inspeção: `applications/composition.js` resolve nomes para report/browse através de SELECT Central direto; o papel limitado `c4g_authority_runtime` recusa-o. Este incremento inclui a correção mínima desse percurso para o port aprovado `responsibles.names`, a partir dos IDs usados nas candidaturas do tenant e com limites e guard antes/depois. Preservar nomes de responsáveis históricos/inativos e isolamento; não conceder permissões adicionais, simular respostas ou ampliar o âmbito a outros endpoints. Este terceiro overlay fica identificado separadamente dos dois overlays tenant034, com regressão própria e nova derivação.

O pedido de comprovação autoriza a prova funcional no âmbito isolado já descrito no protocolo: novos contentores próprios PostgreSQL18/Keycloak, imagens locais identificadas por digest, portas loopback efémeras, bases/roles/grants e dados sintéticos, instalação042/043 e tenant034 apenas nessas bases, servidor local e autenticação OIDC/PKCE, seguida de cleanup dos recursos identificados por UUID/label/ID. Nenhuma operação usa o ambiente habitual, suspende serviços existentes ou altera a sua configuração. Não executar a carga M/H nesta fase; W é opcional e C6 exige uma otimização candidata futura, mantendo-se explicitamente desativados.

## Critérios de aceitação

1. Derivação reproduzível da baseline original: lista de fontes, correção tenant034, novos executores/testes/contratos e inputs públicos auxiliares. Excluir credenciais, configurações reais, dependências instaladas e builds; identificar dependências reutilizadas. Recusar destino existente e qualquer drift antes/depois da execução.
2. Executores M/H respeitam contagens, ordem, volumes, aquecimentos, quantis, métricas e limites do protocolo original. Modos funcionais e de carga são distintos; nenhum comando funcional inicia a matriz de carga. Dados/identidades do seed são fixados por hash, incluindo quaisquer campos temporais relevantes para a medição futura.
3. Fixture usa central043 e tenant034, writer inativo, duas organizações e papéis de runtime limitados. Não reutilizar `pg_read_all_data`, bypass RLS ou autorização sintética no percurso HTTP. Instalação/seed podem usar o proprietário exclusivamente para preparar as bases descartáveis.
   O diretório de responsáveis do relatório não pode usar a ligação Central genérica: utiliza o port fechado, mantém nomes históricos, recusa perdas de autoridade e limites excessivos, e conserva verificações de guard em torno da leitura.
4. Prova HTTP real com login OIDC/PKCE, sessão segura e seleção de organização: report, catálogo privado e dashboard respondem com resultados esperados nos dois tenants; acessos cruzados e sessão não autenticada recusados. Validar esquema, catálogo de compatibilidade, autoridade/membership, RLS e drenagem. A prova é funcional, não uma medição de capacidade ou um SLO.
5. Instrumentação observacional preserva valores/erros/semântica, regista todas as tentativas, intervalos e população dos quantis; não inventa métricas indisponíveis nem altera pools, timeouts ou decisões de autorização. Execução incompleta, erro, drift, falta de drenagem ou cleanup impede PASS.
6. Testes de integridade/recusa/contagens/estatística/limites dos novos executores, regressões relevantes tenant034, sintaxe, suites backend/frontend e build. Reconciliar as provas existentes com os hashes derivados; não apresentar a prova writer original como certificação automática de código alterado.
7. Relatório da execução funcional com fontes/imagens, seed, resultados sanitizados e cleanup comprovado. Documentar comandos concretos de utilização e prontidão de cada executor; revisão independente e atualização do trabalho ativo.

## Sequência

Contrato → executores e regressões locais → versão derivada → validação local → prova funcional HTTP isolada → integridade/cleanup → revisão e documentação. A execução de carga é um passo posterior, com o descritor final do ensaio fixado, sem interpretar tempos da prova funcional como resultados de desempenho.
