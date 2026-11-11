# Correção da consulta de acessos

Problema: a listagem usa `ORGANIZATION_MEMBERSHIP_MANAGE`, uma operação sensível que exige autenticação recente. Uma sessão válida de administrador/gestor pode, por isso, receber 403 ao consultar acessos após cinco minutos.

Critérios de aceitação:
- Separar a consulta da alteração, com permissão de leitura própria para os mesmos perfis locais elegíveis.
- Manter validação da sessão, membership, versões, organização e auditoria.
- Manter autenticação recente obrigatória nas alterações de perfil/estado.
- Distinguir indisponibilidade de serviço de falta de permissão na mensagem da listagem.
- Cobrir leitura com autenticação antiga, escrita recusada, isolamento e perfis não elegíveis; executar suites e build.

Os 500/503 e 409 reportados requerem evidência de runtime própria; não são atribuídos automaticamente à falha de autorização.
