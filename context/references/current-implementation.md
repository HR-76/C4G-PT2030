# Implementação Atual — Piloto UBI

## Estatuto

Esta fotografia preserva informação útil do sistema existente. Não representa a arquitetura nem o modelo de produto aprovados.

## Factos verificados

- SPA React 18/Vite em `frontend/`.
- API Express 5 CommonJS em `backend/`.
- Uma base PostgreSQL configurada por variáveis de ambiente.
- Perfis globais `ADMIN` e `PROFESSOR` em JWT de oito horas.
- Token e utilizador guardados em `localStorage`.
- Estrutura UBI fixa com faculdades, centros e investigadores.
- Oportunidades, áreas, matching lexical, candidaturas, membros, parceiros, anexos, notificações, importações e integrações.
- Estados fixos de candidaturas e histórico de mudanças.
- Uploads persistentes no disco local.
- SMTP implementado no backend e outbox sem worker identificado.
- Jobs de notificações, retenção e sincronização dentro do processo da API.
- Migrações SQL incrementais sem runner completo e registado.
- Ausência de suite geral de testes, lint e type checking.

## Diferenças para o produto pretendido

- Não existem organizações, memberships globais, bases por cliente ou isolamento multi-tenant.
- UBI está codificada na interface, esquema, seeds e reporting.
- `PROFESSOR` é perfil de segurança em vez de função configurável.
- Qualificação e candidatura não estão modeladas como processos separados.
- Matching limita-se a áreas e palavras-chave, sem elegibilidade, pesos versionados ou explicação persistente.
- Não existem tarefas, aprovações configuráveis, pipelines por organização ou documentos versionados.
- Catálogo central e dados privados da organização não estão separados.
- Não há deduplicação com revisão humana, histórico de fontes ou qualidade formal.
- Reporting é específico da UBI e não tem definições versionadas.
- API, worker, armazenamento e e-mail não estão separados conforme a arquitetura aprovada.

## Problemas conhecidos relevantes para migração

- A retenção automática pode eliminar oportunidades e candidaturas por cascata; o produto futuro exige arquivo.
- Ficheiros físicos podem ficar órfãos.
- Desativar ou despromover um utilizador não revoga imediatamente o JWT atual.
- A atualização genérica permite deixar o sistema sem administrador ativo.
- Importações podem ficar em `PROCESSING` após falha geral.
- Várias migrações não têm scripts npm correspondentes.

## Elementos reutilizáveis

- Estrutura inicial de frontend e componentes de oportunidades/candidaturas.
- Separação parcial do backend em rotas, controladores e serviços.
- Modelo básico de oportunidades, candidaturas, membros, parceiros e histórico.
- Experiência adquirida com fontes externas, importação Excel e notificações.
- Catálogo inicial de áreas e matching lexical como dados de referência do piloto, não taxonomia universal.
