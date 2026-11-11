# Plano operativo — criação de entidades e utilizadores

18/10/2026 · Plano da [feature ativa](platform-entities-users-and-access.md). Atualização: utilizadores em entidades existentes e gestão de acessos operacionais localmente, com [prova e revisão](../reviews/platform-member-access.md). A criação de nova entidade continua pendente de composição no ecrã habitual. As observações abaixo registam o ponto de partida do plano.

## Evidência e fronteiras

Retoma autorizada a 18/10/2026: painel administrativo de criação de utilizadores e gestão de acessos por entidade. Implementar uma operação própria de adesão a entidade existente, independente da criação da entidade, com perfil pretendido, identidade reutilizada, projeção de pessoa, convite manual e ativação atómica. O painel C4G deve gerir perfis/estado sem simular membership do administrador C4G. Reusar o componente Acessos com API específica da plataforma, preservando revisão, controlo de versão e repetição idempotente. Não alterar globalmente uma conta ao suspender um acesso local.

Composição visual: tabela de utilizadores na ficha da entidade, ação Adicionar utilizador junto ao título; formulário nome/email/perfil seguido de revisão; preparação e convite no resultado. Tokens C4G e tipografia existentes, títulos alinhados à esquerda e ações explícitas. Evitar indicadores decorativos; destacar a entidade destinatária em todos os passos. Validar desktop/móvel e navegação por teclado. Capacidades provenientes do servidor; conta já associada deve encaminhar para Acessos sem duplicar/reativar.

- Diretório de consulta já operacional; `platformDirectory` não tem comandos de criação.
- `platformOnboarding/service.js`, contratos/SQL/auditoria e `platformOnboardingRoutes.js` cobrem entidade e primeiro administrador, com ports de identidade/tenant/projeção/verificação. Factory HTTP deliberadamente não montada no runtime habitual.
- Migração 020: uma operação por organização (`organization_id UNIQUE`) e um membro por operação. Os convites atuais referenciam essa operação. **Não reutilizar a operação de criação de entidade para cada utilizador adicional**, nem retirar a unicidade para contornar esta fronteira.
- KeycloakAdapter reutiliza issuer/subject e ownership de operações; PostgreSQLProvisioner cria tenant e identidades distintas; o journal cifrado suporta retoma. Foram validados em composição isolada, não na instalação habitual.
- Runtime local ainda substitui o diretório por snapshot da entidade inicial; configuração atual não resolve tenants criados pela nova interface.
- `organizationDirectory/accessProfiles.js` já define os três perfis e grants; o gestor não pode elevar para administrador/gestor. Reutilizar a política ao ativar um novo vínculo, com reautorização transacional.

## Sequência de execução e provas

1. **Composição operacional local.** Separar a API dos adaptadores privilegiados; configuração própria de callback/SPI, identidade de serviço limitada, journal e credenciais. Confirmar migrations/preflight e backup/restore. Substituir o snapshot fixo pelo diretório validado para API/worker, com credenciais referenciadas por entidade. Não usar o primeiro tenant como fallback. Teste com duas bases físicas e dados/tarefa anteriores preservados.
2. **Percurso de entidade.** Formulário em três passos conforme contrato existente, comando com requestId estável e digest, resultado consultável após resposta perdida. UI recebe capacidades e estados do servidor. Preparação retomável; ligação manual emitida só quando o estado permite. Guardar apenas o necessário à operação; token apresentado uma vez e nunca em persistência do browser/logs. Login/aceitação/ativação real de conta nova e existente; revisão em 1440/390 antes de fecho.
3. **Novo agregado para vínculo/utilizador adicional.** Migração aditiva a numerar na implementação. Organização existente, pessoa/identidade, perfil pretendido, autor, intenção idempotente, fases de preparação/projeção, convite, expiração e auditoria. Não criar base nova. Separar conta global de membership e evitar suspensão global por falha de um vínculo.
4. **Autorização para adicionar pessoas.** C4G escolhe entidade por ID validado no servidor; administrador/gestor usam contexto organizacional atual, sem aceitar outra organização do corpo. C4G/administrador: três perfis; gestor: Técnico. Revalidar antes de cada comando, emissão/aceitação e atribuição atómica de grants. Revogação do emissor/capacidade pretendida invalida a conclusão, como no primeiro administrador. Não revelar vínculos externos no ecrã organizacional.
5. **Ecrãs de utilizadores.** Ação na ficha C4G e em Acessos com nome/email/perfil, revisão e resultado. Conta existente mantém credenciais e aceita o vínculo. Membership já presente encaminha para a gestão existente; não altera silenciosamente um perfil nem reabre uma suspensão. Campo “Técnico” não atribui equipa/candidatura; inclusão em equipa usa o percurso já existente.
6. **Gates de integração.** A/B com técnico apenas na equipa, gestor incapaz de atribuir outro perfil, email/identidade repetidos, convite usado/expirado/revogado/substituído, concorrência, falha de IdP/projeção/commit, retoma após reinício, catálogo comum e tarefas/candidaturas anteriores intactas. Browser com percurso real, não só testes unitários ou formulário sem backend.

## Fora desta execução inicial

Envio de email de ativação/recuperação, anexos/antivírus e publicação externa mantêm as dependências já adiadas. Não criar faturação, newsletters ou acesso a parceiros. Instalação local validada não prova domínio público, residência, RPO/RTO ou rollout de produção.

Próximo passo: preparar a composição operacional local do serviço de entidade/primeiro administrador e provar a segunda entidade antes da montagem do formulário.
