# Runbook de staging — migration da base Central

## Âmbito e princípios

Este runbook prepara uma execução controlada das migrations centrais até `002_f3_organization_memberships`. Não provisiona infraestrutura, não define fornecedor cloud e não autoriza produção. A base Legacy não recebe migrations centrais nem participa no backup ou rollback da Central.

O merge `bc981df66a9b1655c08329d3afce21b072e92e34` é apenas a base anterior e não contém `db:central:preflight`. O artefacto do ensaio deve ser fixado no commit revisto que vier a incluir esta implementação: `<REVIEWED_PREFLIGHT_COMMIT_SHA>`. É proibido iniciar o procedimento enquanto esse marcador não tiver sido substituído por um SHA Git completo de 40 caracteres e aprovado; não se deve antecipar o futuro hash.

## Responsabilidades e decisões pendentes

Antes do ensaio, a organização responsável deve nomear, fora do repositório:

- responsável pela mudança e pessoa com autoridade para aprovar ou abortar;
- operador das migrations e operador independente do backup/restore;
- ambiente, cluster e base concretos de staging;
- gestor de segredos e mecanismo de injeção das variáveis;
- tecnologia de backup, retenção, localização e cifragem;
- RPO, RTO, janela de mudança e duração máxima aceitável de locks;
- canal de incidentes, dashboards e alertas;
- pipeline ou mecanismo one-shot aprovado.

Estes elementos estão **pendentes** e não devem ser inferidos a partir do ambiente local.

## Identidades e variáveis

Usar identidades separadas:

- **migration:** acesso apenas à Central, leitura de catálogos/marker/ledger, advisory lock, DDL e DML necessários às migrations;
- **runtime Central:** privilégios mínimos de leitura/escrita da aplicação, sem DDL;
- **runtime Legacy:** credencial distinta e sem acesso à Central;
- **backup/restore:** permissões apenas para a operação e destino aprovados.

Variáveis relevantes, apenas por nome:

- `NODE_ENV`
- `C4G_RUNTIME`
- `CENTRAL_DATABASE_URL`
- `DATABASE_URL`
- `PORT`
- `CORS_ORIGIN`
- `AUTH_MODE`
- `PUBLIC_APP_URL`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`
- `OIDC_POST_LOGOUT_REDIRECT_URI`
- `SESSION_SECRET`
- `SESSION_COOKIE_NAME`
- `SESSION_COOKIE_SECURE`
- `SESSION_IDLE_MS`
- `SESSION_ABSOLUTE_MS`
- `OIDC_TRANSACTION_MS`
- `AUTH_POLICY_VERSION`
- `AUTH_ASSURANCE_POLICY_JSON`
- `PRIVILEGED_LOGIN_ASSURANCE_CATEGORY`

`CENTRAL_DATABASE_URL` e `DATABASE_URL` são obrigatoriamente distintas. Não existe fallback entre elas. Os valores são fornecidos pelo mecanismo aprovado do ambiente e nunca guardados no repositório ou na evidência textual.

## Pré-requisitos e evidência inicial

1. Registar SHA do artefacto, ambiente, janela e identidades técnicas usadas.
2. Confirmar que o alvo foi identificado externamente como staging e que não é produção nem Legacy.
3. Confirmar conectividade cifrada e restrita segundo a política operacional ainda por aprovar.
4. Confirmar PostgreSQL major 17. Os fingerprints atuais foram derivados e validados nessa versão major, independentemente da distribuição do sistema operativo; outras versões falham fechado.
5. Confirmar espaço, conexões, transações longas e locks que possam bloquear DDL.
6. Suspender writes incompatíveis conforme a estratégia `expand → migrate → contract`; o mecanismo concreto permanece pendente.
7. Confirmar que logs do job não imprimem variáveis, URLs ou credenciais.

## Backup e ensaio de restore

1. Criar um backup consistente da Central com a tecnologia aprovada.
2. Registar identificador, instante UTC, escopo, ferramenta/versão e checksum da evidência ou artefacto quando suportado.
3. Restaurar o backup numa base isolada, nunca sobre staging, produção ou Legacy.
4. Verificar marker, ledger, contagens de controlo não sensíveis e fingerprint na base restaurada.
5. Eliminar a cópia isolada apenas segundo o procedimento operacional aprovado.

Abortar se o backup não puder ser identificado, verificado ou restaurado. O comando concreto de backup não é especificado porque o fornecedor e a tecnologia ainda não foram aprovados.

## Preflight anterior

Executar com a identidade de migration e apenas `CENTRAL_DATABASE_URL` definida para a Central alvo:

```text
npm run db:central:preflight
```

O preflight é somente leitura e deve confirmar:

- marker `C4G/CENTRAL`;
- ledger como prefixo contínuo conhecido (`000`, `000/001` ou `000/001/002`);
- checksums e atributos `irreversible`;
- fingerprint físico correspondente à versão corrente.

Os ficheiros SQL centrais são texto UTF-8 e a sua representação canónica converte exclusivamente `CRLF` para `LF`; nenhum outro byte, espaço, comentário ou token é normalizado. Novas aplicações executam essa representação e registam sempre o checksum LF canónico. Para as migrations publicadas `000`, `001` e `002`, o runner e o preflight aceitam também o checksum CRLF derivado do mesmo SQL lógico, para compatibilidade com ledgers criados por checkouts Windows anteriores. Esta compatibilidade não aceita qualquer outra divergência e nunca reescreve automaticamente `checksum_sha256`, `applied_at`, `irreversible` ou a versão do ledger. PostgreSQL major 17 permanece o único contrato suportado.

Critérios de aprovação: exit code zero, mensagem de sucesso, backup restaurado com sucesso e nenhuma divergência operacional. Abortam a mudança: marker inválido, Legacy, versão desconhecida, lacuna, checksum divergente, fingerprint divergente, backup/restore inconclusivo, identidade excessiva/incorreta ou alvo ambíguo.

## Aplicação one-shot

Depois da aprovação registada, executar uma única vez, com o mesmo artefacto e identidade de migration:

```text
npm run db:central:up
```

O job deve apontar exclusivamente para a Central e terminar antes do arranque da nova aplicação. Não executar o comando na Legacy. Guardar timestamps, SHA, exit code, versões aplicadas e mensagens sanitizadas.

## Verificação posterior e arranque

1. Executar novamente `npm run db:central:preflight`; exigir `002_f3_organization_memberships`, checksum e fingerprint esperados.
2. Arrancar a API com identidades runtime, nunca com a identidade de migration.
3. Confirmar readiness separado da Central e Legacy.
4. Executar em staging smoke tests exclusivamente sintéticos:
   - autenticação sem acesso tenant implícito;
   - organização e membership sintéticas válidas;
   - recusa de membership inexistente, inativa ou cruzada;
   - contexto de sessão consistente e invalidado por versão.
5. Remover ou arquivar os dados sintéticos conforme o procedimento aprovado, preservando a evidência necessária.

## Monitorização, aborto e recuperação

Monitorizar durante a janela e no período definido externamente:

- resultado do job, duração e locks;
- erros PostgreSQL, conexões e saturação;
- readiness da Central e Legacy;
- erros HTTP 5xx, autenticação, sessão e seleção organizacional;
- divergências do ledger ou fingerprint.

Antes de existirem writes F3, o rollback permitido é `npm run db:central:down:f3`, seguido de preflight na versão `001`. Depois de existirem dados F3, o rollback elimina estruturas F3 e pode perder dados; a preferência é correção forward. Qualquer rollback após writes exige decisão explícita, preservação dos dados e plano aprovado.

Abortar ou manter a aplicação indisponível se qualquer gate falhar. Não interpretar falha como sucesso degradado.

## Evidências a conservar

- SHA do artefacto e versões das ferramentas;
- alvo lógico e identidade usada, sem segredos ou connection strings;
- aprovação e critérios verificados;
- identificador, hora e checksum do backup;
- resultado e evidência do restore isolado;
- saídas sanitizadas dos preflights e migration;
- ledger e fingerprint observados;
- resultados de readiness, smoke tests e monitorização;
- decisão de conclusão, aborto, rollback ou correção forward.
