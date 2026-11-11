# Link autenticado da candidatura — 2026-11-03

ApplicationLinkGate integrado na rota real /candidaturas/:id da GCNI_C4G. Sem parâmetro mantém navegação existente. Com organizacao valida UUID da candidatura/contexto e rejeita parâmetro repetido ou inválido. Mesma organização permite montar o detalhe; organização diferente consulta apenas /auth/organizations e exige confirmação explícita. POST existente seleciona organização; só a sessão confirmada correspondente permite montar PrivateApplications.

Enquanto o contexto não corresponde, o detalhe não é montado: não inicia GETs de candidatura, equipa, parceiros ou documentos. Layout pode continuar a mostrar dados gerais da organização atualmente autenticada. Organização indisponível apresenta mensagem genérica, sem título da candidatura. Falha de consulta permite repetir; seleção recusada não abre detalhe. Duplo clique bloqueado. Respostas de lista de utilizador/contexto anterior descartadas com cleanup e AbortController.

A rota protegida existente mantém o destino relativo completo até DirectLogin, que o codifica como returnTo OIDC. Não altera autenticação ou permissões backend. A seleção continua sujeita à validação central e o detalhe às permissões da candidatura. O parâmetro não concede acesso nem muda organização silenciosamente. Template de email existente já gera este formato de link.

Validação: 10 testes do gate; testes adicionais na rota App real e DirectLogin para preservação do destino. Suite frontend completa: 715 aprovados em 83 ficheiros. Build Vite aprovado. Backend, contratos/template de emails: 29 aprovados. Diff check aprovado. Log: application-status-link-frontend.log.

Limite: provas automatizadas React/router/API mock e template; não foi feita autenticação OIDC contra fornecedor real nem envio de email. Nenhuma base da APP alterada, nenhum deploy; emails reais permanecem desativados.

Próximo passo: validar o percurso integrado mudança de estado → mensagem simulada → abertura da candidatura, nos perfis administrador e membro, incluindo mudança de organização.
