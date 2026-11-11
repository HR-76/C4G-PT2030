# Recuperação de envios dos parceiros
State: Complete

Correção aprovada: só permitir escrita e repetição após consulta atual com canEdit === true. Durante carregamento, erro de acesso e consulta sem edição, preservar a intenção sem oferecer repetição. 401/403/404 retiram os dados e ações anteriores, preservando formulário/intenção; reconsulta explícita recupera permissões, sem envio automático. Histórico obedece ao mesmo bloqueio. Proteção no handler, incluindo confirmação de remoção. Manter chave idempotente, payload e contexto; servidor mantém autorização existente.

Aceitação: regressão prévia, membro sem permissão, permissão ausente, carregamento, perda de acesso na escrita/histórico, recuperação explícita com mesma intenção; testes completos, build e Chrome simulado nos dois perfis. Sem alteração de API/esquema, links oficiais ou infraestrutura.

## Entrega e revisão

- canEdit estritamente verdadeiro controla ações e repetição; handler também recusa envios sem autorização consultada e verifica contexto da intenção. Referência atual protege a confirmação assíncrona de remoção.
- 401/403/404 retiram projeção e histórico da vista e apresentam recuperação explícita; intenção e dados do formulário não são apagados. Erros de validação/conflito mantêm tratamento existente. Reconsulta não envia automaticamente.
- Regressão inicial: 6 falhas reproduzidas. Frontend final: 687 testes aprovados / 82 ficheiros; backend: 2592 aprovados, 7 ignorados, zero falhas. Build aprovado.
- Chrome com API simulada: administrador/membro, 1440px/390px; ações normais, pendente sem edição, recusa 403, recuperação explícita, payload e chave idempotente iguais, limpeza apenas após confirmação. Evidência em output/playwright/partner-pending-permissions/verification.json. Captura do membro inspecionada.
- Revisão focada concluída sem bloqueios. Sem alteração de API, backend, grants, esquema ou links oficiais. Testes em infraestrutura real não realizados; R2/ClamAV e deploy permanecem adiados.

Próximo passo: validar perda de permissão e recuperação de envios pendentes na equipa e tarefas da candidatura, reutilizando a componente existente.
