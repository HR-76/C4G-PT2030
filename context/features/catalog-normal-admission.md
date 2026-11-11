# Admissão normal do catálogo 048
Estado: Complete neste incremento isolado (02/11/2026).
Âmbito: compatibilidade045/048 e configuração de arranque desligada. Sem promoção, base habitual ou fontes.
Aceitação: ledger completo, core, authority, catálogo, writer e leitura com permissões exatas;046/047 recusadas; schema/ACL/checksum/gap recusados; sem cache de decisões; modo disabled e controlled recusado no launcher. Todos os critérios passaram.
Provas:20 controlos PostgreSQL18.3,2517 testes backend PASS/7 SKIP herdados,585 frontend PASS,build PASS,node --check PASS.
Autorrevisão: corrigida allowlist do leitor antigo, hashes de ACL medidos contra SQL fixo, manifesto sintético dos testes atualizado sem reduzir as asserções. Histórico preservado. Nenhum finding material aberto neste âmbito.
Limites: não provisionados logins dedicados nem adaptador durável de exposição no destino. Não houve autenticação institucional real nem nova carga. Migrações irreversíveis; falha transacional reverte, mas instalação concluída não tem down destrutivo.
Primeiro acesso futuro aprovado: administrador da entidade com membership ativa.
Próximo passo: preparar na cópia isolada o fornecedor durável do leitor e as credenciais dedicadas, preservando OFF, antes do ensaio final de ativação controlada.
