# Diagnóstico HTTP — 2026-11-02

Reproduzidas as oito falhas nos ficheiros auditHttpCorrections.test.js, centralImportHttp.test.js e centralManualAuthoring.test.js: todas com fetch failed. Um servidor HTTP mínimo em 127.0.0.1 confirmou connect EACCES no ambiente restrito, independentemente da aplicação.

Correção operacional: executar os testes locais com permissão de ligação loopback, através da aprovação de execução fora da restrição. Nenhuma alteração de código, assertions, permissões da APP ou configuração de emails foi necessária.

Validação nas mesmas condições permitidas:
- Três ficheiros HTTP mais applicationStatusEmails.test.js: 47 aprovados, zero falhas.
- Suite completa backend com reporter TAP: 2630 testes, 2623 aprovados, 7 ignorados, zero falhas; exit 0. Evidência: application-status-emails-http-validation.log.

O registo parcial anterior permanece como histórico da execução restrita, não como defeito confirmado da aplicação. Frontend inalterado; build não necessário para esta correção exclusivamente operacional. Emails continuam desativados; sem SQL, persistência, produtor, envio real ou deploy.

Próximo passo: preparar persistência aditiva e integração transacional do produtor com testes em ambiente isolado, mantendo os emails desativados.
