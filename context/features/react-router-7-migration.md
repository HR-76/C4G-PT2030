# Migração controlada do React Router e acompanhamento nodemon

Estado: Review — migração implementada e validada no âmbito isolado em 01/11/2026; suite global afetada por alterações concorrentes de apresentação.

## Contrato

Pedido explícito do utilizador para avançar após a revisão de qualidade. Migrar React Router/DOM 6.30.6 para 7.18.5, versão corrigida confirmada no registo, conservando modo declarativo, React 18, URLs, parâmetros, login OIDC, guardas de acesso e isolamento de sessão. Não adotar SSR/framework/data router nem alterar políticas de autorização.

Critérios: testes de navegação com a árvore App real, rotas splat, precedência das rotas de perfil, query/hash, histórico, redirects de sessão e recusa administrativa; testar flags `v7_startTransition` e `v7_relativeSplatPath` ainda em v6, depois a mesma cobertura em v7; suite frontend completa e build; auditoria online sem advisories Router. Dependências/lockfile fixam a versão migrada, sem atualizar majors não relacionadas.

Nodemon: verificar versão upstream e dependência minimatch. Aplicar apenas correção compatível publicada; se ausente, documentar versão, advisory, alcance, comando de acompanhamento e critério de resolução. Não forçar override minimatch 11 nem downgrade nodemon. Não criar agendamento recorrente sem frequência acordada.

Preservar todo o worktree anterior. Sem commits, deploy, dados, migrations, fontes EU, processos da aplicação habitual ou infraestrutura externa. Baseline local anterior: frontend 535 PASS/build PASS; backend 2403 PASS/7 SKIP.

## Evidência upstream

- [Guia oficial v6→v7](https://reactrouter.com/7.18.4/upgrading/v6): Node >=20, React >=18; flags para splats e transitions. Node instalado 24.13.1, React 18.3.1.
- [Router redirect advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6): corrigido >=7.18.0.
- Consulta npm online em 01/11/2026: nodemon latest 3.1.14, minimatch `^10.2.1`; última 10.x é 10.2.6. [Advisory minimatch](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249): fix 11.0.1, padrão não fiável e optimizationLevel >=2 necessários.

## Resultado

### Implementação

`frontend/package.json` fixa `react-router-dom` em **7.18.5**; lock resolve `react-router` na mesma versão. Apenas estes dois pacotes mudaram de versão neste incremento: saiu `@remix-run/router` 1.23.4 e entraram as dependências do Router `cookie` 1.1.1 e `set-cookie-parser` 2.7.3. Nenhum pacote backend foi alterado. Mantêm-se os imports `react-router-dom` e o modo declarativo compatível, sem refatoração de rotas nem políticas.

As flags foram ativadas temporariamente no BrowserRouter v6 e exercitadas nos testes, depois retiradas com a instalação de v7, onde esse comportamento é padrão. `main.jsx` terminou sem diferença funcional face ao início. Os lazy components já eram criados no âmbito do módulo; os links dos dois splats são absolutos, pelo que não foi necessário mudar os URLs.

### Validação

- Acrescentados dez testes em `frontend/src/components/AppRouterMigration.test.jsx`, usando a árvore App real e páginas de teste para isolar navegação/autorização. Cobrem precedência das rotas de perfil, splats, query/hash, voltar do browser, destino de login, recusa de administração, admissão limitada e resolução lazy sob transitions.
- Ponte v6 com flags: **22/22 PASS**, incluindo os dez novos testes, DirectLogin e RoutePage. Uma expectativa inicial do teste apontava erradamente o membro para dashboard; foi corrigida após confirmar que `getHomePath` já define `/catalogo`. O produto não foi alterado para satisfazer essa expectativa.
- Os mesmos 22 testes passam com v7. Build final PASS (Vite 6.4.5). Auditoria online frontend **zero vulnerabilidades**; `npm ls react-router react-router-dom --depth=1` confirma 7.18.5 sem árvore inválida.
- Durante a suite completa, outro trabalho alterou a apresentação de oportunidades e os seus testes. A primeira execução teve 545 PASS/4 FAIL; a seguinte 524 PASS/25 FAIL; a última **550 PASS/2 FAIL**. Não se declara a suite global verde nem se alteraram testes desse trabalho para obter aprovação.
- Para isolar causalidade sem trocar dependências do workspace, instalado Router 6 numa pasta temporária e congelados ficheiros fonte/fixtures. A primeira comparação A/B deu **120 PASS/1 FAIL** em ambas as versões; a segunda, depois de novas alterações concorrentes, deu **114 PASS/1 FAIL** em ambas, com o mesmo nome de teste falhado: `interest detail consumes preserved v2 facts including budget and all seven cutoffs`. Nenhuma diferença de resultado v6/v7 nos snapshots comparados.
- A outra falha da última suite completa foi um `TypeError` em `opportunityFirstAnalysis.js` ao ler `amount`, no trabalho concorrente; já não surge no segundo snapshot A/B. Preservados os logs anteriores, sem atribuir essas falhas à migração nem ocultá-las.
- Backend não sofreu alterações neste incremento: não se repetiu a sua suite; a auditoria online `--omit=dev` continua com zero avisos. Não foram usados PostgreSQL/Keycloak reais nem browser E2E.

Originais, logs, comparação de versões e snapshots: `%TEMP%/c4g-router7-20261101/`. A preparação da comparação Windows exigiu normalizar paths e transformar os módulos temporários; uma tentativa inicial falhou antes de executar testes e foi corrigida, não contada como resultado funcional.

### Acompanhamento nodemon

Verificação atual: **nodemon 3.1.14** é a versão latest e requer minimatch `^10.2.1`; o lock mantém 10.2.6. Sem backport corrigido na major 10 publicado no registo consultado. Auditoria backend completa: **dois avisos moderados**, cadeia nodemon/minimatch; produção: **zero**.

`nodemon/lib/monitor/match.js` passa `dot`, `nocase` e `windowsPathsNoEscape`; não ativa `optimizationLevel >=2`. O minimatch instalado usa nível 1 por omissão. O aviso continua visível; esta análise não substitui a futura atualização. Sem override minimatch 11, sem downgrade nodemon e sem alterações ao comando de desenvolvimento.

Rever na próxima manutenção de dependências e antes de promover uma nova imagem de desenvolvimento:

```powershell
npm view nodemon@latest version dependencies.minimatch --json --offline=false
npm view minimatch@10 version --json --offline=false
# Em backend/
npm run audit:security
npm run audit:security -- --omit=dev
```

Critério de resolução: release compatível do nodemon ou backport minimatch reconhecido pelo advisory; atualizar o lock, verificar arranque/restart com fixture isolada, suite backend e repetir auditoria. Não suprimir avisos nem considerar `audit --force` uma correção segura. Não foi criado agendamento automático.
