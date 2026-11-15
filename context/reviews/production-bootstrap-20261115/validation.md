# Validação do instalador de produção

15/11/2026. Implementação no working tree sobre `f5f5560e572c01b253ea711ce698cb866789e073` (`Prod 3`). Não houve commit, push, deploy, ligação ao staging ou alteração de infraestrutura real.

## Resultado funcional

`backend/scripts/installProductionPlatform.js` cria uma instalação nova ou retoma a mesma intenção: Central058, tenant041, sete logins Central separados, login API do tenant, publicação F4, primeira entidade e administrador C4G_ADMIN. ORG_ADMIN exige escolha explícita na configuração. A autoridade mantém MFA opcional.

O modo plano não escreve. O modo aplicação fixa host/porta, identificador físico e propriedade dos recursos; recusa instância partilhada, staging, conflitos de identidade e drift de permissões. As nove credenciais são verificadas na retoma, incluindo o permit secret através de SCRAM privado no proprietário NOLOGIN. A conta Keycloak é previamente criada e verificada por GET; não há alterações no fornecedor.

A composição de runtime existente foi preservada. A única extensão partilhada é uma factory opcional de ligação em `memberProjection`, para preservar a CA configurada no instalador; o comportamento dos chamadores existentes continua igual. Não foram alteradas migrações057/058 nem os seus fingerprints. Na Central vazia, o bootstrap normaliza o proprietário de `pg_control_system()` para o nome técnico já fixado pela057.

## PostgreSQL descartável

PostgreSQL18.6, instâncias próprias inicializadas com administrador `bootstrap_admin`, autenticação SCRAM, porta aleatória exclusivamente loopback e dados em diretórios próprios `.tmp/production-bootstrap-*`. O gate não aceita URL externa. Os dados de ambos os clusters aprovados foram removidos depois de parar o processo; os recibos não contêm passwords, tokens ou dados pessoais reais.

| Percurso | Verificações | Evidência |
| --- | ---: | --- |
| Falhas e retomas | 43 aprovadas | [Recibo completo](full-results.json) |
| Instalação direta | 34 aprovadas | [Recibo completo](fresh-results.json) |

As provas incluem rollback da cadeia Central, falhas nas oito fases duráveis, retoma sem duplicação/rotação, recuperação de elevação técnica interrompida, manifesto exato058/041, perfis com logins reais, comandos permitidos e proibidos, rejeição de CONNECT a outra base, RLS, grants ORG_ADMIN exatos, MFA opcional, resolução real da identidade e F4 pelo coordenador limitado, auditoria SERVICE sem dados privados e ausência de acesso implícito a uma segunda entidade.

## Verificações locais

- 49 testes focados do instalador aprovados, após confirmação das regressões antes da correção.
- Frontend: 1150 testes aprovados em 128 ficheiros; build aprovado.
- Lint completo, sintaxe dos 16 ficheiros JavaScript/CJS alterados e `git diff --check` aprovados.
- Backend final: 3502 testes, 3493 aprovados, 9 ignorados já existentes e zero falhas. [Resumo estruturado](validation-summary.json).

Uma execução intermédia da suite backend terminou o processo de `fundingPlatformCatalog.test.js` sem diagnóstico adicional. O ficheiro não foi alterado: os seus 6 testes passaram imediatamente em execução isolada e na corrida final completa. A corrida final foi feita sem gates PostgreSQL concorrentes. Não se atribui causa não demonstrada a essa ocorrência.

## Limites e passo operacional seguinte

O fornecedor OIDC foi simulado nos testes; os comandos e autorizações PostgreSQL foram reais. A prova não substitui o ensaio do login real, email, R2/ClamAV, certificados, imagem/container e restauro na infraestrutura dedicada. A primeira entidade, o subject OIDC, os segredos, o identificador físico e a configuração final têm de ser preenchidos em privado. PostgreSQL17 é admitido pelos contratos existentes, mas este gate foi executado em18.6.

O [runbook](../../runbooks/production-bootstrap-installer.md) contém configuração, plano, aplicação explícita, artefactos privados, retoma e rollback. Não eliminar bases nem fazer downgrade da058 para contornar um erro. A instalação e o deploy reais continuam por executar e exigem pedido próprio.
