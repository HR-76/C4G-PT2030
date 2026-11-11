# Revisão dos perfis internos no ecrã Acessos

18/10/2026, 16:09 (Lisboa) — **Review: implementado, validado e ativo no ambiente habitual**. Revisão visual do utilizador ainda não inferida.

## Resultado funcional

O utilizador corrigiu a matriz inicial: o gestor da entidade também gere os acessos da sua equipa. A implementação usa três perfis fixos e as memberships existentes, conforme [contrato](../features/organization-internal-access-profiles.md).

- Administrador atribui Administrador, Gestor de candidaturas ou Técnico a outras contas da entidade e suspende/reativa esses acessos.
- Gestor atribui Técnico a uma conta de Consulta existente e suspende/reativa técnicos. Não altera administradores/gestores nem promove esses perfis.
- Técnico não gere acessos e conserva a restrição de candidaturas por equipa.
- O próprio acesso não pode ser alterado neste ecrã. Isto mantém um administrador ativo durante alterações autorizadas; outro administrador deve fazer a mudança.
- Perfis e concessões são atualizados em conjunto, com versões, auditoria e repetição segura. A migração não altera perfis ou concessões existentes.

## Verificação

| Verificação | Resultado |
| --- | --- |
| Backend: perfis, técnicos, autoridade e migrações | 65 testes PASS |
| Regressão de tarefas, alertas, relatórios, catálogo e fronteiras do worker | 20 testes PASS |
| Frontend: Acessos e tarefas | 10 testes PASS |
| Compilação frontend e sintaxe backend | PASS |
| Migração central 019 e reversão em PostgreSQL descartável | PASS; [prova](../../output/playwright/c4g-internal-access/migration.json) |
| HTTP, duas entidades, concorrência, repetição, rollback após UPDATE e tarefas | PASS final; [prova](../../output/playwright/c4g-internal-access/http-verification.json) |
| Chrome 1440/390, atribuição e releitura, suspensão e reativação | PASS final; [prova](../../output/playwright/c4g-internal-access/browser-verification.json) |
| Ativação e OIDC habitual | PASS: [migração local](../../output/playwright/c4g-internal-access/local-upgrade.json), [OIDC/dados](../../output/playwright/c4g-internal-access/native-verification.json) |

Os ensaios reais de alteração usam exclusivamente contas e candidaturas sintéticas em bases descartáveis. A validação nativa foi de leitura, sem converter perfis reais: uma membership ORG_ADMIN, próprio acesso protegido, zero alterações de contas/grants/dados de negócio. API e worker reiniciados, health pronto.

## Diferenças corrigidas durante a revisão

1. Alterações concorrentes de autoridade devolviam erro genérico: o estado de escrita pendente passou a conflito 409, sem contornar a coordenação.
2. A tabela herdada cortava o segundo botão de ação: ações agrupadas e quebra de linha recuperam ambos os botões, incluindo no telemóvel.
3. O gestor não reativa diretamente o perfil de Consulta legado, que pode conter concessões históricas: primeiro atribui explicitamente Técnico; administradores mantêm a gestão do legado.

## Limites

Este incremento gere contas já associadas à entidade. Não cria contas, convites ou acessos externos; parceiros mantêm-se informativos. Não implementa um configurador de permissões. Armazenamento, antivírus e email continuam adiados. A entrega 5 global permanece em curso.

## Apresentação verificada

- [Administrador — desktop, ensaio](../../output/playwright/c4g-internal-access/admin-1440.png).
- [Gestor — desktop, ensaio](../../output/playwright/c4g-internal-access/manager-1440.png).
- [Gestor — telemóvel, ensaio](../../output/playwright/c4g-internal-access/manager-390.png).
- [Ambiente habitual — desktop](../../output/playwright/c4g-internal-access/native-access-1440.png).
- [Ambiente habitual — telemóvel](../../output/playwright/c4g-internal-access/native-access-390.png).
