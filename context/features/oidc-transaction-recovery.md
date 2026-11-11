# Correção de transações OIDC e recuperação de entrada

Estado: Complete — 29/10/2026. Login confirmado pelo utilizador após recuperação.

## Problema e âmbito

O erro reportado `OIDC_TRANSACTION_INVALID` acontece antes da validação OIDC, quando falta a transação na sessão ou o seu prazo terminou. O utilizador confirmou entrada em `localhost:3000` com login recém-aberto.

O diagnóstico Central exclusivamente read-only localizou uma pendência `PREPARED` de `NOTIFICATION_READ` desde 26/10/2026 às 01:18:59 UTC. As cinco falhas recentes de autenticação coincidem com o subject bloqueado; o callback é consumido, mas a rotação de sessão é cancelada pela pendência. A compensação elimina a sessão e repetir o callback devolve o erro reportado. Após reinício, o coordenador só recebe o adaptador de recuperação depois de uma operação tenant, criando uma dependência circular com o login. Diretório, tenant e snapshot atuais coincidem com a origem e o backend original já não existe. A operação pertence ao Dev habitual, sem relação com gates pausados.

Foi ainda reproduzido offline um defeito independente: uma segunda tentativa anónima, iniciada perto da expiração física da sessão anterior, conserva esse prazo e pode desaparecer segundos depois.

Esta correção mantém os contratos F2 de sessão server-side, cookie host-only, origem, CSRF, state, nonce, PKCE e consumo único. Abrange a disponibilidade inicial do adaptador de recuperação F5, o prazo de sessões anónimas e a recuperação explícita de uma navegação interrompida. Não altera memberships, permissões, política MFA, prazos configurados, schema ou dados de negócio. A pendência só pode ser reconciliada pelo mecanismo existente após prova de identidade física e terminação; nunca eliminada ou ignorada.

## Critérios de aceitação

1. Guardar uma nova tentativa OIDC numa sessão anónima ainda válida renova o prazo físico durante a escrita coordenada, sem ficar limitado ao prazo da tentativa anterior. O callback dentro do prazo configurado consegue recuperar a transação.
2. Touch mantém o prazo físico imutável; sessões autenticadas mantêm a expiração absoluta. Uma escrita atrasada não recria sessões eliminadas, revogadas ou expiradas.
3. Transação ausente, expirada ou com data inválida continua recusada antes do consumo e da validação OIDC. O limite temporal é exclusivo (`createdAt + TTL > now`).
4. Numa navegação que aceita HTML, o callback inválido encaminha para `/login?authentication=expired`, sem transportar códigos, state, nonce ou URLs fornecidas pelo pedido. Respostas não podem ficar em cache. Clientes JSON conservam HTTP 400 e `OIDC_TRANSACTION_INVALID`.
5. O ecrã de login informa que a tentativa terminou e oferece «Voltar a entrar»; não reinicia automaticamente, incluindo React StrictMode. O cancelamento existente mantém o seu comportamento.
6. Regressões primeiro em RED, depois GREEN; testes focados, suites completas de backend/frontend, build e sintaxe dos JavaScript alterados. Testes usam doubles e HTTP local descartável, sem DB externa, migrations ou alteração de contas.
7. A composição da API disponibiliza o adaptador de recuperação antes do primeiro login, sem criar ligações ou recuperar operações durante a construção. Só aceita adaptadores reconhecidos; mantém preferência por bindings explícitos de tenant, recusa de reconfiguração, deriva de origem, tenant incorreto e impossibilidade de provar terminação.
8. Uma sessão bloqueada por uma leitura terminada pode concluir a rotação após a recuperação normal. As barreiras por subject/membership, prazos e provas F5 permanecem intactos. A reparação operacional limita-se à pendência identificada de notificações, com pré-condições repetidas; preserva o histórico.

## Verificação

Regressões antes do código: seis falhas de sessão/callback reproduzidas; frontend reproduziu reinício automático indevido de login expirado; a composição real de produção com doubles reproduziu `AUTHORITY_RECOVERY_UNAVAILABLE` na primeira escrita de sessão. Após correção:

- Foco de autenticação/recuperação: 85 PASS, incluindo 14 testes novos do arranque e rotação real do registry com membership.
- Frontend: 401 PASS; build PASS.
- Backend completo: 1677 PASS, 6 FAIL fora do âmbito, 7 SKIP. As seis falhas também ocorreram antes da alteração de recuperação no arranque, em `fundingEnrichmentPersistence.test.js`, sobre evidência/enriquecimento. Esse ficheiro não foi alterado nesta correção.
- Sintaxe dos sete JavaScript de produção/testes alterados: PASS.
- Recuperação operacional executada uma vez através do coordenador existente, após repetir as pré-condições. Resultado `RECOVERED / READ_TERMINAL`, zero pendências restantes. Tenant em READ ONLY, terminação/cancelamento de processos proibidos, histórico preservado.
- API local recarregada e disponível; frontend reposto em 3000 após ter deixado de escutar. `/api/local-health` HTTP 200/ready, callback sem sessão com Accept HTML HTTP 303/no-store para a recuperação, página de recuperação HTTP 200.
- Utilizador confirmou «Já consigo entrar» em 29/10/2026.

Evidência local em `output/oidc-recovery/`: `auth-focused-final.log`, `backend-full-final.log`, `frontend-full.log`, `frontend-build.log`, `recovery-result.json` e reparação restrita `recoverNotificationRead.cjs` (não pode ser reaplicada após RECOVERED).

Sem migrations, alteração de contas, dados de negócio, commit ou deploy. Não foram executados gates de integração externos; o diagnóstico e a reparação operacional da pendência local são distintos das suites com doubles.
