# Integração do pacote de produção

Estado: Review — implementação e validação local concluídas. [Evidência de 15/11/2026](../reviews/production-release-integration-20261115/validation.md): PostgreSQL descartável91 checks; backend3538 aprovados/9 ignorados existentes, frontend1150; focados105, estrutura/executor21, lint/sintaxe/build aprovados. Ensaio Docker preparado, não executado por indisponibilidade local. Não autoriza staging, deploy, commit ou push. Mantém MFA opcional.

## Contrato

Consolidar o instalador Central058/tenant041, o perfil editorial/PQ1 selecionado pela aplicação e os percursos de convites/eliminação num pacote coerente. O perfil de produção do tenant inclui exclusivamente as capacidades funcionais necessárias; os validadores da API, projeção inicial, convites e eliminação usam o mesmo contrato explícito, sem admitir roles arbitrárias. Não alterar migrações aplicadas nem fingerprints publicados. As configurações antigas dos outros ambientes preservam o seu comportamento.

O pacote Docker distingue bootstrap inicial, upgrades e serviços de aplicação. O bootstrap é uma execução explícita, por omissão apenas plano, com ficheiros privados de entrada/saída e acesso ao PostgreSQL e Keycloak próprios. Credenciais instaladoras nunca entram na API. Os ficheiros privados de convites/eliminação têm contratos validados, bindings publicados, clientes Keycloak e ponte de ativação privada; a configuração não inventa identidades reais. O utilizador confirmou também a preparação da validação de faturação e do email de autenticação/histórico para ativação. A primeira entidade e o administrador serão indicados pelo utilizador; permanecem obrigatórios e por preencher nos inputs privados.

Preparar um ensaio Docker independente, com projeto, redes, volumes, contas e dados sintéticos próprios. O ensaio usa a imagem candidata e serviços de teste claramente identificados, verifica a configuração antes de qualquer arranque e não aceita alvos de staging/produção. Não expor administração de bases nem segredos. Se Docker não estiver disponível, entregar o ensaio executável, validá-lo estruturalmente e distinguir essa preparação dos testes efetivamente executados em PostgreSQL descartável.

## Aceitação

- Regressões primeiro: o perfil editorial/PQ1 funciona com o bootstrap e com convites/eliminação, sem grants excessivos ou acesso cruzado.
- Perfis, credenciais e configurações divergentes falham fechados; replay mantém as garantias anteriores. MFA continua `c4g-user-mfa-v1`/opcional.
- Bootstrap Docker usa o instalador completo; upgrades057/058 continuam separados e explícitos. API/worker recebem apenas os seus inputs privados.
- Exemplos e validação cobrem o diretório `http.json`/`worker.json`, TLS/CA, origem/issuer, clientes, bindings e email; placeholders impedem ativação prematura.
- Ensaio isolado prepara aplicação e dependências sintéticas e prova os percursos selecionados ou regista claramente limites de execução. Nada usa volumes, redes, ficheiros ou contas de staging.
- Testes focados, suites completas, lint, sintaxe, build e integração PostgreSQL descartável; documentação e evidência sanitizada do resultado.
