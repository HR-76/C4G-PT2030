# Qualidade, manutenção e fronteiras de segurança — novembro 2026

Estado: Review — implementação e validação local concluídas em 01/11/2026; advisories moderados residuais documentados.

## Âmbito autorizado

Pedido do utilizador: remover código comprovadamente sem uso, separar lógica de apresentação, reutilizar tabelas/filtros/dashboard, verificar erros públicos, SQL parametrizado, validação, isolamento, fontes/CSP e dependências; acrescentar testes de matching, alertas e listagens.

Baseline: branch `feat/f13-organizational-profile`, HEAD `f9f51fdb0b0300f0612a42afd1a7c86d15adac31`, com numerosas alterações anteriores. Preservar integralmente esse trabalho. A implementação atual é evidência; os contratos multi-instituição e a arquitetura futura continuam definidos no contexto existente.

## Critérios de aceitação

1. Erros inesperados nunca devolvem mensagens internas ou stack traces, incluindo em desenvolvimento. Preservar envelopes/status públicos dos domínios e `PublicHttpError`; validar status inesperados e impedir que falhas de observação substituam a resposta.
2. Extrair responsabilidades coesas dos componentes grandes identificados, mantendo paginação, filtros, seleção, apresentação, cancelamento e limites de acesso. Remover apenas bindings/helpers comprovadamente não usados; preservar histórico e scripts operacionais.
3. Verificar valores SQL parametrizados e identificadores dinâmicos limitados a listas internas nos percursos de matching, alertas e oportunidades. Inputs inválidos não chegam à persistência. Não alterar limites, algoritmos de matching, permissões, membership central ou contratos funcionais por inferência.
4. Acrescentar testes comportamentais de matching determinístico, alertas restritos ao destinatário/recurso autorizado e listagens com inputs adversariais/isolamento. Regressões de bugs são executadas antes da correção e depois.
5. Inventariar fontes externas e CSP. Nenhum URL de fonte HTTP nem wildcard de domínio; conservar fontes locais quando não existe dependência externa. Verificar dependências e advisories atuais; atualizações só com compatibilidade demonstrada, registando limitações residuais.
6. Executar testes focados, suites completas backend/frontend, build frontend e `node --check` dos JS backend alterados. Separar falhas preexistentes, skips e verificação não realizada.

## Fronteiras

Sem commits, merge, push, deploy, migrations, grants, alterações de dados/configuração operacional ou retoma de fontes. Não executar gates que criam infraestrutura ou usam bases externas. Testes locais usam doubles e servidores efémeros. Não afirmar ausência universal de vulnerabilidades a partir de uma revisão estática nem equivalência de desempenho produtivo com doubles.

## Achados confirmados antes da implementação

- `backend/src/app.js`: fallback global expõe `err.message` e `err.stack` em desenvolvimento e aceita status arbitrário. A correção será isolada num middleware próprio, preservando o export existente para consumidores/testes.
- `organizationDirectoryRoutes.js`: observação sem proteção em quatro handlers permite que a falha do observador substitua o erro original. Consolidar a resposta e proteger a observação.
- `opportunityInterestRoutes.js`: o mesmo defeito de observação pode substituir códigos/correlação públicos; aplicar regressão e proteção equivalente.
- `utils/programmeMapping.js`: escritor one-shot legado `normaliseProgrammeColumn` sem consumidor; retirar apenas função/export, preservando normalização usada pelas fontes atuais e todo o histórico/dados.
- Catálogo frontend e tabela de candidaturas por oportunidade: pedidos substituídos não cancelam o transporte. Extrair helpers/hook coesos, preservar guards de geração e adicionar regressões de cancelamento.
- Dashboard: separar coordenação de pedidos/exportações da vista; `applicationUi.js`: retirar exports cuja pesquisa confirmou ausência de consumidores.
- Fontes: aplicação usa exclusivamente fontes do sistema; o documento frontend não tem política própria. Acrescentar `font-src 'none'` ao documento e aos headers de desenvolvimento/preview, sem autorizar domínios externos nem alterar outros recursos.
- Dependências: auditoria online confirmou advisories de `xlsx`, Vite e outras dependências. Atualizar `xlsx` para tarball oficial fixo 0.20.3 e Vite para 6.4.5 (compatível com plugin React 4.7.0 e Node instalado); aplicar correções compatíveis adicionais sem `--force`, rever locks e repetir auditorias. Não interpretar `npm audit` offline como verificação atual.

## Resultado e validação

### Alterações

- Tratamento global extraído para `backend/src/middlewares/httpErrorHandler.js`, mantendo o export de compatibilidade em `app.js`. Mensagem genérica em todos os ambientes, status de erro limitado a inteiros 400–599 e resposta inesperada `no-store`. Contratos de domínio, correlação, CSRF, `PublicHttpError` e delegação após início da resposta preservados.
- Observação protegida em quatro handlers do diretório e nove endpoints de interesses; falhas do observador não substituem a resposta original.
- Removidos o escritor legado sem consumidores e 13 exports frontend sem uso; mantidos os mapeamentos de fontes e estados efetivamente consumidos.
- Dashboard usa `useOrganizationDashboard`; filtros, datas UTC e histórico de paginação do catálogo usam `catalogFilters`; validação dos totais usa `applicationSummaries`. Labels partilhados ficam em `utils/applicationStatuses`, sem importar vistas para obter regras.
- Listagem/detalhe do catálogo e resumo de candidaturas da tabela cancelam leituras substituídas/desmontadas. Os clientes HTTP propagam `AbortSignal` sem o inserir na query; guards existentes impedem resultados/exportações obsoletos após mudança de utilizador/organização.
- Fontes exclusivamente do sistema: `font-src 'none'` no HTML gerado e headers Vite de desenvolvimento/preview. Não existem bibliotecas externas dedicadas a tabelas ou filtros; a implementação usa React/HTML e componentes locais.

### Evidência de segurança e limites

Análise AST de 549 ficheiros backend: 1550 chamadas `.query` em 182 ficheiros; 318 argumentos SQL não literais classificados em 134 templates, seis concatenações e 178 variáveis/configurações/wrappers. Não foram encontradas referências diretas a `req/request.body/query/params/headers` nos argumentos de texto SQL. Os builders examinados usam fragmentos internos e identificadores fixos, validados ou em listas permitidas; os valores do utilizador são parâmetros. A análise de 168 respostas HTTP em 34 ficheiros não encontrou envio direto de mensagens internas ou stacks após a correção.

As regressões cobrem texto adversarial em pesquisa/programa como valores SQL, input inválido ou scope forjado sem abrir conexão, matching recusado antes da leitura e após revogação, e reconhecimento de alertas/comunicações de outra organização ou destinatário sem alteração, hidratação ou auditoria de sucesso. A verificação é estática e com testes locais/doubles: não constitui prova universal de segurança nem gate com PostgreSQL/Keycloak real. Nenhuma base, migration, fonte EU ou configuração operacional foi alterada.

### Dependências

| Pacote | Antes | Depois |
| --- | --- | --- |
| SheetJS/xlsx | 0.18.5 | 0.20.3, tarball oficial fixo e integridade no lock |
| multer | 2.1.1 | 2.5.0 |
| body-parser | 2.2.2 | 2.4.0 |
| proxy-addr | 2.0.7 | 2.0.8 |
| qs | 6.15.1 | 6.17.1 |
| brace-expansion | 5.0.5 | 5.0.12 |
| Vite | 5.4.21 | 6.4.5 |
| axios | 1.16.0 | 1.21.0 |
| React Router/DOM | 6.30.3 | 6.30.6 |
| esbuild | 0.21.5 | 0.25.12 |

Também atualizados transitivos compatíveis afetados, incluindo PostCSS e Babel. Sem `--force` nem overrides de versões principais. Vite 6.4.5 é compatível com o plugin React 4.7.0 instalado e Node 24.13.1. SheetJS segue a [distribuição oficial](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) para corrigir [prototype pollution](https://cdn.sheetjs.com/advisories/CVE-2023-30533) e [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9); Vite corrige o [bypass Windows de fs.deny](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff).

Auditoria online após atualizações: backend passou de oito avisos (um crítico, quatro altos, três moderados) para dois moderados; frontend passou de 14 (oito altos, cinco moderados, um baixo) para dois moderados; harness manteve zero. Backend com `--omit=dev`: zero. Frontend com `--omit=dev`: dois moderados. Sem críticos/altos nos três locks auditados.

Residuais explícitos:

- **Desenvolvimento — nodemon/minimatch:** nodemon 3.1.14 continua na major 10 de minimatch. O [advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) exige padrão controlado por atacante e `optimizationLevel >= 2`; o uso examinado no nodemon mantém o nível padrão 1. Não aplicar downgrade sugerido por `audit --force` nem override incompatível.
- **Frontend — React Router 6:** o [advisory de hydration SSR](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg) exclui o modo declarativo usado; o [advisory de redirects com paths não fiáveis](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6) continua no pacote. Os percursos examinados usam paths internos fixos/validados, sem exploit demonstrado. A eliminação do aviso exige migração para 7.18+, com validação de transitions, rotas splat e navegação conforme o [guia oficial](https://reactrouter.com/7.18.4/upgrading/v6); não foi introduzida silenciosamente nesta manutenção.

Para repetir a auditoria, executar `npm run audit:security` em `backend/` e `frontend/`, e `npm audit --offline=false` no harness. Os scripts novos forçam consulta online porque a configuração npm local tem `offline=true`; falha de rede ou avisos conservam saída não-zero. Não foi agendada execução recorrente. O instalador avisou de limpeza de um binário esbuild antigo em uso; instalação, resolução das dependências, transformação com o binário atual e build passaram, sem parar processos existentes.

### Testes

- Baseline anterior: backend 2377 PASS, zero FAIL, sete SKIP; frontend 506 PASS.
- RED→GREEN: seis testes de erros globais; quatro subtestes do diretório mais parent; nove rotas de interesses mais parent; cinco casos de cancelamento/propagação de sinal; três casos CSP. As primeiras execuções sem elevação foram impedidas pelo sandbox (`spawn EPERM`), não por falhas da aplicação; reexecuções autorizadas correram com subprocessos locais.
- Focados: erros HTTP 60/60; matching/alertas/listagem/diretório 47/47; interesses e normalização 20/20; frontend 111/111, antes dos três testes CSP adicionais.
- Frontend final: 535/535 PASS em 70 ficheiros; `npm run build` PASS com Vite 6.4.5. HTML emitido conserva a política de fontes. `node --check`: 11/11 ficheiros backend alterados/novos PASS.
- Suite backend final: 2403 PASS, zero FAIL, sete SKIP (2410 testes), em 50,55 segundos. Os sete skips já existiam na baseline. Total acrescentado: 26 testes backend e 29 frontend.
- Evidência temporária e originais dos ficheiros alterados: `%TEMP%/c4g-quality-20261101/`. Sem commit, push, deploy ou gates de infraestrutura. O CSP dos headers do reverse proxy produtivo e a sua execução num browser real não foram verificados.
