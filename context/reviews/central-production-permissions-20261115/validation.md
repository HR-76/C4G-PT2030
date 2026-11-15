# Validação — permissões Central de produção

15/11/2026. Baseline `736e3a5e28904bb001ad07113853b816bfabbfa1`; alterações locais, sem commit/push/deploy. Staging não foi alterado.

**Seguimento concluído:** as três falhas backend abaixo foram corrigidas e ambas as suites completas passaram. Ver [correção e validação final](backend-suite-repair.md). As contagens abaixo preservam a execução anterior à correção.

## Resultado

| Verificação | Resultado |
|---|---|
| PostgreSQL nativo descartável | 18.6, duas provas finais independentes |
| Upgrade genérico 056→057 e reaplicação | PASS; 30 verificações de permissões e fluxos |
| Instalação limpa até 057 e reaplicação | PASS; 31 verificações, incluindo deriva de EXECUTE para PUBLIC |
| Testes focados de perfil/composição/autoridade/manual/PT2030/diretório | 58 PASS |
| Testes de recolha de schema/preflight/perfil | 49 PASS; contagens sobrepõem-se parcialmente aos focados |
| Histórico e retenção de email | 13 PASS; regressão do fornecedor primeiro vermelha, depois verde |
| Suite backend final | 3412 testes: 3400 PASS, 9 ignorados, 3 falhas preexistentes |
| Suite frontend | 1140 PASS, 1 timeout em ApplicationPartners |
| Repetição isolada ApplicationPartners | 16 PASS |
| Lint | PASS, sem avisos |
| Sintaxe | Todos os JS/CJS alterados verificados; nova alteração de retenção também verificada |
| Build frontend | PASS |
| `git diff --check` | PASS; apenas aviso Git de normalização LF/CRLF |

As três falhas backend são as asserções lexicais de admissão 052 e 053 e `SEC-AC-01 frontend persists only the approved editorial recovery envelope, never authentication`. As duas primeiras procuram imports literais que já não existem no upload runtime do commit de base, onde a lista é derivada do manifest. A terceira incide sobre frontend não modificado neste trabalho. A evidência de baseline está em [baseline-test-evidence.json](baseline-test-evidence.json). Não se alteraram estes testes para ocultar falhas, nem se apresenta a suite completa como verde.

Os testes de metadata dedup foram atualizados para registar a nova versão 057 no seu manifest sintético. A deteção do novo schema foi integrada na mesma consulta de catálogo, mantendo o contrato anterior e evitando uma consulta extra em todas as versões. As verificações de schema e os gates reais passaram depois dessa alteração.

## Evidência reproduzível

- [Resultados do upgrade](upgrade-results.json) e [pins do upgrade](upgrade-pins.json).
- [Resultados da instalação limpa](fresh-results.json) e [pins da instalação limpa](fresh-pins.json).
- [Contagens e hashes dos logs](validation-summary.json).
- Gate: `node test/integration/central-production-permissions/gate.cjs`; instalação limpa com `PRODUCTION_GATE_FRESH=1`.
- Testes: `npm test` em backend e frontend; `npm run lint` na raiz; `npm run build` em frontend.

O gate usa uma porta loopback livre, sem carregar configuração da aplicação. O instalador é exercitado contra essa base e os fluxos usam logins sem superutilizador. O administrador do cluster apenas instala migrações, prepara dados sintéticos e provoca/restaura deriva para as provas negativas. A admissão por fingerprint é verificada antes dos fluxos.

Provas principais: duas organizações no diretório através do protocolo real; recusa de organização e workload não configurados; leitor do catálogo sem PII nem originais; manual e importação PT2030 integral com autoridade SQL real e auditoria transacional; idempotência; rollback perante falha de auditoria; sessão expirada/ator errado; revogação bloqueada até terminar a transação; comandos de email limitados à organização; logs append-only; separação de retenção e claim de envio; DML e pertenças indevidos recusados; deteção de deriva de ACLs, memberships e PUBLIC.

Todos os clusters criados neste trabalho foram parados. Os diretórios de dados temporários foram removidos depois de verificar o caminho absoluto e a ausência de `postmaster.pid`. Os JSON finais foram preservados neste diretório, fora dos dados descartados.

## Limites da conclusão

O storage e o scanner no fluxo PT2030 são doubles explícitos; não foram contactados R2, ClamAV, Keycloak nem destinatários reais. A regressão da limpeza Keycloak verifica o adaptador com double, preservando a limpeza do fornecedor enquanto a retenção SQL usa o job separado. Não houve teste HTTP ponta a ponta com OIDC e bases tenant, nem prova de carga, PostgreSQL 17, configuração de produção ou migração de variantes de staging/member email/user deletion. Estes resultados provam o pacote genérico e os caminhos exercitados, não uma implantação pronta a servir tráfego.

Procedimento e configuração: [implementação e operação](../../features/central-production-permissions-implementation.md).
