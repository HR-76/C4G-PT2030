# Correção das três falhas preexistentes e repetição das suites

15/11/2026. Seguimento autorizado pelo utilizador após a implementação local do perfil Central 057. Este resultado substitui o estado das suites no [relatório inicial](validation.md), preservado como histórico. Staging inalterado; sem commit, push, deploy ou execução SQL neste seguimento.

## Correções

1. **Admissão 052 e 053:** os testes procuravam nomes de imports já substituídos por listas derivadas do manifest. Passam a exercitar a disponibilidade real do runtime de upload com o verificador de schema explicitamente simulado, a validação real do ledger e o preflight de oportunidades. Exigem consulta e revalidação de schema/security e recusam checksum alterado, predecessor ausente, duplicados, irreversibilidade alterada, versão desconhecida e tabelas em falta/adicionais. Mantêm as verificações das restantes listas explícitas. Não se mudou o contrato de admissão nem qualquer runtime.
2. **SEC-AC-01:** faltava reconhecer o hook existente `useNextStepCompletion.js`, que guarda um marcador de interface. A exceção ficou limitada a esse ficheiro, com uma nova prova dinâmica do hook: apenas o valor literal `completed`, chave vinculada ao utilizador, organização, candidatura, estado e data da transição; ação não aplicável não escreve; nenhum outro âmbito herda a conclusão; valores adulterados não são aceites. Mantém-se a proibição de autenticação em storage, de `localStorage` e de consumidores não enumerados de `sessionStorage`. A verificação passa a identificar o ficheiro infrator, em vez de imprimir todo o frontend.

As falhas antigas foram reproduzidas antes das correções. Apenas testes e documentação mudaram neste seguimento. Não se acrescentaram skips, retries, supressões ou timeouts, nem se alterou código de produto para satisfazer as expectativas.

## Validação final

| Execução | Resultado |
|---|---|
| Segurança focada: `node --test backend/test/security/f2Security.test.js` | 50 PASS |
| Pacotes 052/053 focados | 11 PASS |
| Backend: `npm test` | **3404 PASS, 0 falhas, 9 ignorados existentes**; 3413 testes no total |
| Frontend: `npm test` | **1141 PASS**, 128 ficheiros; sem o timeout de parceiros da execução anterior |
| Lint de backend/src, backend/scripts e frontend/src | PASS, zero avisos |
| `node --check` nos quatro ficheiros JS desta correção | PASS |
| Frontend: `npm run build` | PASS |
| `git diff --check` | PASS; apenas avisos de normalização LF/CRLF pelo Git |

As suites completas foram executadas uma de cada vez. As mensagens esperadas dos testes de navegação jsdom e falha sintética de chunk no frontend não produziram falhas de teste. Os testes HTTP locais do backend correram fora da restrição de loopback do sandbox; não usaram staging nem bases externas.

Evidência: [contagens e hashes dos logs](backend-suite-repair-summary.json). Os logs completos estão nos caminhos locais `.tmp/backend-suite-repair-*` e `.tmp/backend-allowlists-*` identificados nesse JSON.

As provas PostgreSQL anteriores mantêm-se como evidência da implementação 057; não se repetiram porque esta correção não altera SQL, grants, manifests ou runtime. Os novos doubles verificam contratos de admissão e comportamento, não substituem aqueles gates nem demonstram uma implantação real.
