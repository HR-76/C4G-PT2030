# Falhas de ligações Central e tenant — prova isolada

Estado: em validação. Em PostgreSQL descartável com duas organizações sintéticas, impedir temporariamente o login do leitor central e do login API de um tenant e testar recusa de ligações novas, independência do outro tenant e recuperação após repor LOGIN. Usar apenas roles e contentor criados pela fixture; nunca registar credenciais ou URLs de ligação.

O teste não simula queda completa do servidor Central, sessões já abertas, efeito sobre a API HTTP, persistência de commit incerto ou indisponibilidade Neon. Complementar com testes de pool, autoridade e readiness. Nenhum bypass de RLS ou relaxamento de permissões é aceitável.

## Resultado em 09/11/2026

[Prova](../reviews/central-tenant-login-outage-20261109/results.json) PASS: ao negar novos logins do tenant A, A recusou e uma ligação já aberta de B continuou operacional; ao repor LOGIN, A voltou a ligar. O mesmo exercício para o leitor central recusou novas ligações e recuperou após reposição. As mudanças de LOGIN ocorreram exclusivamente nas roles da fixture; o contentor próprio foi removido. A continuidade de uma ligação de B não prova funcionamento HTTP quando a Central está indisponível.

105 testes focados PASS após execução com loopback autorizado: pools e limites por tenant, deadlines, descarte e limpeza de ligações, readiness e recuperação de autoridade. A primeira tentativa teve uma falha EACCES de loopback imposta pela sandbox; na repetição passou sem alteração do código. Nenhum defeito produtivo reproduzido; não foi aplicada correção de runtime.

Pendente: simular indisponibilidade real e reconexão, ligações já estabelecidas e commit incerto, falhas na API com guardas e auditoria, e medir contenção com Central e tenants em processos/instâncias independentes. Não inferir disponibilidade produtiva nem RPO/RTO. R2 real permanece adiado.
