# Adaptadores reais de onboarding em composição isolada

Estado: Review, 18/10/2026. Execução explicitamente autorizada pelo utilizador. Continuação do serviço central 020; ecrã, realm e bases habituais não alterados. [Resultados e limites](../reviews/platform-onboarding-real-adapters.md): 12 grupos do gate real, 17 do serviço central, 47 testes direcionados e sintaxe de 13 ficheiros PASS.

## Âmbito e critérios

1. Adaptador Keycloak 26.8.0 por Admin REST: criar sem password/email verificado, reconciliar pelo identificador estável e marcador de ownership, recusar colisão com conta desconhecida. Conta central existente usa o issuer/subject conhecido e preserva credenciais.
2. Provisionamento PostgreSQL real de bases distintas, migrações completas, logins API/WORKER separados e limitados, diretório central publicado apenas após verificação. Retoma após falha/reinício sem recriar bases nem substituir dados.
3. Projeção inicial da ficha da entidade/pessoa do primeiro administrador dentro da base correta, com recibo idempotente. Central continua fonte de verdade da membership.
4. Processo de provisionamento separado por IPC na composição isolada. O serviço HTTP recebe portas fechadas, sem pools de administração; os adaptadores privilegiados são construídos no worker. O orquestrador do ensaio mantém acesso administrativo para bootstrap e inspeção das infraestruturas descartáveis, pelo que isto não comprova a separação de segredos de uma implantação pública. Journal técnico privado cifrado para retoma; não é uma nova área de configuração do produto.
5. Serviço central existente efetua a ativação atómica. Ponte Keycloak da prova anterior revalida o convite deste serviço. HTTPS, cookies transitórios, CSRF e OIDC real com PKCE/state/nonce/assinatura; login normal da aplicação depois da ativação.
6. Gate Chrome/PostgreSQL/Keycloak: conta nova e existente, retoma, revogação com formulário aberto, conta errada, isolamento físico/API, catálogo comum e preservação de tarefas. Reportar precisamente quaisquer limites de infraestrutura local versus implantação final.

Sem clientes reais, envio de email, R2/antivírus ou alteração do ambiente habitual. A SPI continua restrita ao realm descartável. O processo de integração pública/implantação exige revisão própria depois desta prova.

## Referências técnicas

Conferida a [Admin REST API 26.8.0](https://www.keycloak.org/docs-api/26.8.0/rest-api/index.html) e o [guia de extensões Keycloak](https://www.keycloak.org/docs/latest/server_development/index.html#_auth_spi). Código e compatibilidade verificados contra a versão fixa da imagem, não apenas contra documentação latest.

Próximo passo: preparar a composição do ambiente habitual, com separação operacional dos segredos e configuração própria da ativação, antes de ligar o formulário.
