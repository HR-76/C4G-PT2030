# Prova isolada — entidade e ativação manual

Ensaio de viabilidade autorizado em 18/10/2026. Não é uma implementação de produção, nem uma migração da instalação habitual.

## Executar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/platform-onboarding/gate.ps1
```

Com imagem já compilada, acrescentar `-SkipBuild`. Requer Docker Desktop, Chrome no caminho usado pelos gates existentes e dependências locais do backend e frontend/test-harness. Compila Java 21 dentro do Docker; não instala Java/Maven no computador.

O script cria contentores com nomes únicos e etiqueta `c4g.proof=manual-onboarding`, PostgreSQL em 127.0.0.1:5598 e Keycloak em 127.0.0.1:8283. Remove apenas esses contentores/volumes no finally. Não usa as bases 5432/5433, Keycloak 8080/8443 ou aplicação 3000/5000. Não enviar links deste ensaio a utilizadores reais.

O servidor transitório de prova usa 5283 e escuta interfaces locais para permitir o acesso do Keycloak via host.docker.internal. O endpoint da ponte exige segredo aleatório, partilhado apenas por variáveis do processo/contentor; só contas example.invalid. HTTP é uma exceção desta prova descartável. Não reutilizar esta exposição ou configuração em produção.

## Componentes

- `keycloak/`: imagem Keycloak 26.8.0 com Authenticator e RequiredAction experimentais. O authenticator só aceita o realm c4g-manual-proof. A ação delega política/armazenamento da password ao UpdatePassword nativo, verificando o convite antes do formulário, antes da escrita e antes do sucesso.
- `directory.js`: usa os repositories centrais reais para criação, preparação, falha/retoma, schema e publicação. A/B usam bases físicas migradas pelo gate existente e credenciais API distintas; a resolução HTTP passa a consultar o diretório persistido.
- `flow.js`: servidor transitório de convite, persistência de digest/estado em schema de teste, browser real e OIDC com PKCE/state/nonce e verificação de assinatura/JWKS. Conta existente usa login normal e associação ao subject exato.
- Hook opt-in `PLATFORM_ONBOARDING_PROOF=1` no gate de integração já existente. Ausente essa variável, outros percursos ficam inalterados.

## Limites deliberados

O consume do convite tem transação, rollback e controlo de concorrência. A criação da membership e da sessão de aplicação usa o helper de ensaio existente, **não** uma transação de onboarding pronta para produção. O callback OIDC é real, mas a passagem para a sessão final da aplicação continua por integrar. Não confundir o MFA sintético da fixture HTTP com autenticação MFA realizada no Keycloak desta prova.

O laboratório prova partes integradas, não atomicidade distribuída entre Keycloak e Central: falhas depois de consumir o convite e antes de criar o vínculo ainda precisam de coordenação persistida/retoma no produto. Revogar antes do POST de password é testado; a corrida entre a última validação e commit em sistemas distintos exige reconciliação e recusa de acesso na Central. A extensão experimental não tem contrato de manutenção aprovado.

O diretório API é real; verificam-se ACLs de ligação do worker, mas não um job autenticado com credenciais de worker nesta prova. Não há backup/restore de cliente real, HTTPS público, controlo de privilégios C4G nas novas rotas administrativas (essas rotas ainda não existem), emissão administrativa final, auditoria F7 dos convites, rate limiting de produção ou formulário de Entidades ligado ao runtime habitual.

Segredos existem apenas em memória/variáveis de processo e no estado efémero do Keycloak; os convites na base guardam digests. Relatório e capturas excluem passwords e ligações. Capturas de falha são diagnóstico de ensaio e não substituem `verification.json` final. A página de conclusão é uma página técnica, não o desenho final C4G.

## Evidência

`output/playwright/c4g-onboarding-proof/verification.json`, `native-password-form.png` e `activation-complete.png`. Só considerar PASS quando o script terminar com código zero e o relatório estiver concluído. Falhas ficam registadas como FAIL; não há clientes reais de demonstração.

## Referências da extensão

- [Keycloak 26.8.0 — Server Developer Guide](https://www.keycloak.org/docs/26.8.0/server_development/): SPIs de autenticação e required actions.
- [UpdatePassword nativo, versão 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/authentication/requiredactions/UpdatePassword.java): reutilizado por herança, sem cópia da implementação.
- [Keycloak 26.8.0 Admin REST API](https://www.keycloak.org/docs-api/26.8.0/rest-api/index.html): configuração do realm, fluxo e ação apenas no laboratório.
