# Dashboard — custo das três operações tenant

Estado: Review — 31/10/2026. Agrupamento, regressões e comparação real do coletor concluídos; medição HTTP pendente por indisponibilidade da aplicação. [Resultados e limites](../reviews/dashboard-tenant-read-cost.md).

## Âmbito

O agregado mantém as etapas `report`, `privateSummary`, `centralSummary` e `dashboardContext` na ordem atual. O incremento procura reduzir o custo repetido das três operações tenant, preservando três leases sequenciais e dezoito snapshots frescos por pedido no ambiente observado. A otimização anterior de pré-autorizações do relatório permanece presente em ambos os braços.

Candidato: agrupar consultas mínimas de segurança dentro de cada chamada fresca a `tenantSchemaSnapshot`, conservando as mesmas evidências e fingerprints. A configuração real usa diretório fora do coordenador; por isso não sustenta a redução de transações antes considerada para `revalidateAuthority`. Esse agrupamento não será implementado neste incremento.

O primeiro A/B real confirmou paridade e menos comandos, mas não demonstrou ganho de latência do coletor. O perfil `EXPLAIN ANALYZE` READ ONLY localizou o maior custo na projeção de constraints. Segundo recorte permitido: comparar em memória a substituição exclusiva de `to_jsonb(con)->>'conenforced'` por `row_to_json(con)->>'conenforced'`, conservando a extração booleana, o fallback para PostgreSQL17 e a rejeição de constraints não canónicas. Só aplicar depois de regressão e prova real de igualdade; não remover constraints ou alterar o normalizador para obter fingerprints compatíveis. Os planos guardados contêm apenas tipos de nós, contagens e tempos, sem SQL, filtros ou dados privados.

Sem cache de autoridade ou metadados, remoção de verificações, união das três leases, paralelização de fontes, alteração de permissões, aumento de pools/deadlines, migrations ou gestão de serviços habituais. Membership central, fingerprints e decisões de autorização conservam-se.

## Aceitação

1. Congelar os SELECTs anteriores e executar regressões antes da alteração produtiva. Preservar SQL/argumentos, ordenação, tipos, propriedades opcionais, condições de recolha, serialização e fingerprints.
2. O agrupamento termina no mesmo checkpoint. Não partilhar resultados entre checkpoints, pedidos ou organizações. Preservar todas as consultas adicionais e verificações antes/depois da função privilegiada, lock, execução, auditoria e finalização.
3. Regressões cobrem igualdade de snapshots/fingerprints, respostas malformadas, falhas, dados vazios, frescura e concorrência. Não alterar fingerprints registados para acomodar diferenças. Executar suites e build conforme AGENTS.md antes do fecho.
4. Observador exclusivo do processo de ensaio: etapas, transações centrais físicas/de autoridade, snapshots/fingerprints e leases emitidas. Preservar argumentos, receiver, resultados, erros e identidade dos objetos internos.
5. Baseline usa a versão congelada de `tenantSchemaFingerprint`, compilada com o caminho original para conservar imports; candidato usa a versão atual. Só o export observado `tenantSchemaSnapshot` seleciona a variante por pedido. `tenantLeaseExecutor` e todos os objetos protegidos permanecem únicos. Fontes anteriores/candidatas são fixadas por hash e o diff é revisto antes de comparar.

## Medição

Harness próprio em `test/integration/dashboard-tenant-cost/`, reutilizando o host efémero anterior sem alterar os seus artefactos. O login ocorre na aplicação existente e só se fazem GETs funcionais autenticados ao resumo; cookies ficam no contexto do browser. Não arrancar/reiniciar serviços alheios nem executar o ensaio enquanto a readiness ou a estabilidade da janela paralela043 não estiver confirmada.

Modo inicial `--profile`: um aquecimento e três leituras da baseline atual. Modo posterior `--compare`: um aquecimento por variante e dez pares AB/BA sequenciais. Só ativar comparação quando o candidato e o seu guard estiverem fixados. Exigir HTTP200, três leases/dezoito snapshots, paridade funcional e de fingerprints, fontes/configuração/ledger central sem drift, ausência de queries pendentes e cleanup próprio.

Se a aplicação HTTP estiver indisponível durante o trabalho paralelo, medir o coletor isoladamente na base tenant existente, exclusivamente pela credencial limitada `state.credentials`, com transação `BEGIN TRANSACTION READ ONLY`, rollback/fecho próprios e sem alterar roles/configuração/dados. Perfil inicial: um aquecimento e cinco snapshots; comparação: um aquecimento por variante e dez pares AB/BA. Observa apenas contagens, hashes de statements e durações; não guarda SQL, argumentos, nomes privados, credenciais ou conteúdo do snapshot. Exigir fingerprint estável e fonte/configuração inalteradas; interromper na primeira diferença. Este perfil localiza custo do coletor; não mede ganho do dashboard nem substitui o ensaio HTTP/OIDC. Script próprio `test/integration/dashboard-tenant-cost/profile-snapshot.cjs` e resultados em `output/dashboard-tenant-cost/`, sem iniciar serviços ou executar gates.

Guardar apenas tempos, contagens, hashes e códigos de diagnóstico permitidos em `output/dashboard-tenant-cost/`; sem SQL, parâmetros, payloads privados, credenciais ou cookies. Preservar tentativas falhadas. Tempo do driver, spans inclusivos e HTTP são medidas distintas; não converter contagens em ganhos de latência. Publicar resultados negativos e outliers. Sem commit, push ou deploy.

## Resultado

Comandos por snapshot25→9; fingerprints idênticos em22 observações PostgreSQL. Mediana65,54→65,62ms e média67,11→66,79ms: não foi demonstrado ganho material de latência. O protótipo `row_to_json` foi descartado após medição desfavorável. Regressões19 PASS, observador5 PASS, foco54 PASS, backend2280 PASS/7 SKIP, frontend495 PASS e build PASS. A aplicação habitual continua indisponível nas portas3000/5000; o ensaio HTTP está preparado, sem iniciar serviços de outros trabalhos.
