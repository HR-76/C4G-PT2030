# Perfil institucional e custos comuns — incremento 5

Validação concluída em 06/11/2026. O perfil abre 23% mais depressa e a navegação interna melhora 29%. A redução de leituras centrais comuns não demonstrou melhoria generalizada da abertura: as restantes páginas tiveram medianas 1–3% superiores. PERF-01/02/03 permanecem em curso. Sem deploy, reinício ou alterações nas bases habituais.

## Alterações

- Diretório: captura e resolução adjacentes da sessão usam um grupo de autoridade, concluído antes da admissão na base da organização.
- Perfil: as cinco decisões de capacidades usam uma única leitura protegida de membership/política. Cada decisão continua a ser avaliada e auditada. O snapshot é imutável e local à operação, vinculado a ator, versões, cliente, transação, guarda ativa e validade temporal; não é partilhado entre pedidos.
- Política fechada DIRECTORY_CONTEXT permite preparar eventos observacionais autorizados, com gravação síncrona na mesma transação antes dos controlos finais e commit. Recusas/eventos críticos fazem flush prévio e são gravados imediatamente. Mantêm-se os seis eventos e a respetiva ordem. Falhas de infraestrutura nas capacidades agora impedem publicar o perfil, em vez de serem interpretadas como simples ausência de permissão.
- Leituras de candidaturas, unidades, relatórios e dashboard partilham os dados protegidos entre seleção de visibilidade e capacidades de transição. As políticas por recurso permanecem; comandos e preparação da guarda usam as portas frescas originais.

Apenas três ficheiros de runtime alterados neste incremento: `organizationDirectory/composition.js`, `applications/composition.js` e `security/tenantLeaseExecutor.js`, em `backend/src/`. Sem alterações de frontend, SQL de dados, schema, migrações, grants de produto, pools, timeouts ou locks de escrita.

## Comparação real no browser

Quatro execuções sequenciais A/B/B/A, 48 medições: quatro aberturas e duas navegações por página/versão. A usa os três ficheiros anteriores congelados; B usa a implementação atual. Mesmas imagens Docker e fontes, integridade verificada em cada execução, bundles de frontend A/B byte a byte iguais. Sem suites/builds concorrentes.

Fixture descartável PostgreSQL 18.6, central 050, Keycloak 26.8/OIDC real, duas bases de organizações, 1000 candidaturas e 250 pessoas por organização, seis alertas guardados, duas candidaturas com prazo e um alerta de outro destinatário. Abertura medida até resposta principal, fim do indicador de carregamento e pintura; candidaturas/alertas exigem conteúdo visível. Todas as respostas API observadas nas aberturas tiveram sucesso.

| Página | Abertura antes | Depois | Variação do tempo | Navegação antes | Depois |
|---|---:|---:|---:|---:|---:|
| Perfil institucional | 4,79 s | 3,68 s | −23,2% | 3,86 s | 2,73 s |
| Dashboard | 4,17 s | 4,31 s | +3,2% | 3,07 s | 3,11 s |
| Candidaturas | 4,09 s | 4,15 s | +1,6% | 2,94 s | 2,79 s |
| Alertas | 5,46 s | 5,52 s | +1,2% | 3,16 s | 2,74 s |

Valores são medianas. No perfil, todas as aberturas B (3,57–3,75 s) foram mais rápidas que A (4,58–4,92 s). O fim dos pedidos auxiliares melhora de 5,89 para 4,83 s (18%). Nas restantes páginas esse indicador piora ligeiramente, tal como a abertura. Navegação de Candidaturas melhora 5%; Alertas 13%, mas com apenas duas amostras por versão e grande dispersão em A (2,70–3,61 s), não é prova robusta de ganho nos alertas. Dashboard não melhora.

Resultados locais sintéticos com instrumentação; não estimam capacidade nem latência de produção. Os intervalos das restantes páginas sobrepõem-se e a amostra é pequena: não atribuir causalidade a variações de poucos pontos percentuais. Não comparar valores absolutos com fixtures de incrementos anteriores. A referência A já inclui as correções anteriores.

## Segurança e regressões

[Gate isolado final](../profile-security-final-20261106/results.json): COMPLETE, integridade preservada, sem erro de cleanup.

- Payload do perfil e seis eventos de auditoria, incluindo ordem e conteúdo, iguais ao baseline com permissões restritas e completas.
- Cada uma das cinco capacidades removida individualmente: resultado exato preservado. Ausência da permissão principal recusa dados; ausência de transição remove capacidades sem alterar os registos visíveis.
- Payload de candidaturas e unidades equivalente; paginação assinada preservada e cursor adulterado recusado.
- RLS/roles e organizações cruzadas verificados. Falha de auditoria síncrona impede publicação em perfil e candidaturas.
- Quatro pedidos simultâneos de perfil e quatro de candidaturas: todos 200 e completos.
- Revogação concorrente real nas duas operações: escritor registado e bloqueado durante a leitura protegida; commit da leitura precede o da revogação; pedidos posteriores recusados.
- Regressões RED antes da correção, depois testes focados e suites completas: backend **2730 PASS, 7 SKIP, 0 FAIL**; frontend **814 PASS**; builds normal/A/B e verificações sintáticas PASS. Os sete testes ignorados não substituem o gate isolado executado.

A [primeira tentativa do gate](../profile-security-20261106/results.json) falhou numa expectativa incorreta do ensaio: o utilizador sintético inicial não tinha permissões para criar/renomear/mover unidades. Conservou-se a evidência, corrigiu-se a expectativa e acrescentou-se um cenário com concessão explícita dessas permissões apenas na fixture. Nenhuma alteração de runtime foi necessária para essa correção do ensaio.

Todos os contentores próprios foram removidos: consulta final por label `c4g.http-proof` devolveu zero resultados. Não foram usados dados reais. Sem publicação ou ativação no ambiente habitual.

## Evidência e pendências

[Comparação completa, intervalos e amostras](comparison.json), [comparador reproduzível](compare.cjs), execuções [A1](../profile-a1-20261106/results.json), [B1](../profile-b1-20261106/results.json), [B2](../profile-b2-20261106/results.json), [A2](../profile-a2-20261106/results.json). Baseline e harness em `test/integration/profile-performance/`; cada execução guarda hashes de fontes e identificadores das imagens.

Prioridades seguintes: decompor a abertura entre sessão, CSRF, acesso de faturação, pedido principal e sincronização dos alertas; medir custos residuais de metadados/admissão e auditoria antes de alterar outros percursos. A abertura do perfil ainda demora 3,68 s e as restantes páginas continuam entre 4,15 e 5,52 s nesta fixture. Não considerar a lentidão transversal resolvida. Qualquer otimização adicional deve preservar os mesmos controlos e repetir comparação isolada.
