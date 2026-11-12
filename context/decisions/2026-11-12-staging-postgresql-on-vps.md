# Decisão: PostgreSQL do staging na VPS

Estado: aceite pelo utilizador em 12/11/2026. Por implementar.

## Decisão

O ambiente de staging (`app-teste.c4g.ai` e `login-teste.c4g.ai`) usa PostgreSQL 18 instalado na VPS C4G, com superutilizador, em vez do Neon.

## Motivo

As migrações publicadas não correm sem superutilizador. A [sonda de 12/11/2026](../features/managed-postgres-installer-authority.md) mostrou que a migração Central `009_authority_commit_guard` exige um estado de roles que o PostgreSQL 16 ou posterior não permite criar sem superutilizador, e que há pelo menos um segundo bloqueio na mesma migração. O Neon, como qualquer PostgreSQL gerido, não concede superutilizador. As vias alternativas (alterar migrações publicadas ou copiar um schema construído com superutilizador) têm esforço e resultado por medir.

## Âmbito e limites

- Aplica-se ao staging. A [decisão de alojamento](hosting-and-external-services.md) mantém o Neon como fornecedor previsto para produção; essa escolha fica por reavaliar com a medição completa das migrações.
- O staging deixa de provar o comportamento da produção em Neon (ligações, suspensão do compute, privilégios).
- Backups, recuperação, atualizações e disponibilidade do PostgreSQL do staging passam a ser responsabilidade C4G. A base fica indisponível quando a VPS falhar.
- O PostgreSQL escuta apenas em loopback ou rede interna da VPS; não é exposto à Internet.
- Dados sintéticos apenas, como em qualquer staging.

## Atualização (12/11/2026)

A release de staging existente já corre sobre Neon graças a um perfil de código fora do Git (ver [implantação](../features/staging-vps-deployment.md)). O perfil prova que a migração 009 pode ser satisfeita de forma limitada em PostgreSQL gerido, mas está congelado na Central 035 e no tenant 033 e obriga a fixar de novo checksums e fingerprints a cada migração. Com migrações a entrar quase diariamente (tenant 034 a 040 em 11/11), manter o staging em Neon custaria esse trabalho em cada versão. Este custo reforça a decisão para o staging; a escolha para produção fica por rever, partindo desse perfil se for preservado no repositório.

## Por decidir

- Uma base Keycloak no mesmo PostgreSQL ou separada.
- Política de backups do staging e onde ficam as cópias.
- Fornecedor de PostgreSQL para produção.
