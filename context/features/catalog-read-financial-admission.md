# GCNI — correspondências financeiras e admissão isolada

Estado: **Complete neste incremento isolado**. A melhoria global permanece In Progress. Data: 01/11/2026.

## Resultado e âmbito

Projeção interna atualizada para `gcni-catalog-projection/1.1`. Contrato G1/G2, extensão 1.0 e snapshots v2 originais preservados. Nenhuma alteração a rotas, frontend, entrypoints, manifesto ativo, fontes ou base habitual. O serviço de leitura continua por implementar.

O pacote de ensaio aplica a cadeia original até Central045 e acrescenta duas entradas locais (046/047) com checksums e registo transacional. Estes números pertencem ao manifesto isolado, não foram reservados ou registados no manifesto operacional. A migração de projeções 1.0 anterior não foi reescrita; a nova migração acrescenta aceitação de projeções 1.1 e as proteções de aprovação. Projeções antigas e novas podem coexistir.

## Correspondências financeiras fechadas no contrato atual

| Origem v2 | Representação G1 | Regra de preservação |
| --- | --- | --- |
| Dotação única CALL_TOTAL | summary.funding e FundingLine | Montante decimal textual e moeda explícita/nula; não soma dotações. |
| Apoio mínimo/máximo por projeto, pessoa, mês ou pessoa-mês | FundingRule.conditions e scopeLabel | Limites, unidade, moeda, condições da fonte e evidências explícitos; nunca vira dotação global. |
| Taxa pontual ou intervalo de percentagens | FundingRule.conditions | Mantém mínimo/máximo e âmbito. Não presume taxa base, majoração ou teto. Os componentes sem semântica confirmada ficam UNSUPPORTED. |
| Custos elegíveis mínimos/máximos | FundingRule.conditions | Conserva precisão decimal, moeda desconhecida e âmbito. |
| Verba partilhada, estimativa, inicial ou decomposição | FundingLine + regras de qualificação | Mantém sharedGroupId, qualificadores e aviso de não somar automaticamente. Referências múltiplas a programas/fundos são apresentadas separadamente. |
| Período financeiro | FundingLine.period | Texto original, sem aspas JSON introduzidas pela projeção. |
| Zero sem explicação | Regra explícita + summary.funding UNSUPPORTED | Não apresenta ausência de verba como facto confirmado. Zero explícito conserva o valor. |
| Conflito financeiro | Regra CONFLICT + qualidade conflicted | Sem seleção automática de alternativa; publicação bloqueada. |

O contrato aprovado não tem campos tipados para unidades/intervalos monetários. A cobertura foi fechada na sua representação textual explícita, sem alterar esse contrato. Não se promete ordenação ou filtragem numérica desses intervalos. Os valores tipados continuam na revisão v2 imutável. A taxa publicada, mesmo pontual, não identifica necessariamente uma taxa base. UNSUPPORTED neste caso comunica essa ausência de semântica, não perda do valor publicado.

## Migração e permissões

- Aplicação com lock transacional, verificação da identidade CENTRAL, baseline045, sequência/checksums do ledger e assinatura do novo esquema/permissões. Repetição devolve zero migrações; uma falha injetada reverte SQL, roles e registos.
- Assinaturas anteriores não foram alteradas. A diferença esperada no catálogo central são apenas SELECT e REFERENCES sobre revision para o novo proprietário. Foi medida e fixada numa assinatura própria do pacote, juntamente com o novo schema. O leitor antigo não passa a aceitar este estado implicitamente.
- Proprietário, escritor, leitor e aprovador são roles separadas. Não existem memberships novas para a APP. Contas efémeras de teste provaram acesso limitado, ausência de herança automática e impossibilidade de assumir proprietário/outros perfis; a revogação é efetiva na ligação existente.
- A aprovação liga projectionId, extensionId, acceptanceDigest, digest SQL do payload e validade. O escritor não aprova nem altera o histórico de aprovação/revogação. A identidade de auditoria é fixada pela base a partir de session_user, não pelo payload.
- Inserção, publicação e reativação de uma geração exigem aprovação válida. Revogação e publicação são serializadas pela mesma linha bloqueada. Aprovação expirada, revogada, associada ao digest errado ou a outro vínculo de aceitação é recusada.
- Conflitos materiais não resolvidos e qualidade conflicted impedem publicação, mesmo com aprovação. Gerações antigas permanecem imutáveis e disponíveis como histórico; revogar uma autorização de publicação bloqueia novas utilizações e não apaga esse histórico. Isto é distinto de revogar acesso de um utilizador.

## Validação executada

**Backend: 2429 testes; 2422 PASS, 0 FAIL, 7 SKIP**, aproximadamente 60 segundos. Dezanove testes focados de projeção/financiamento passaram, incluindo paridade com o contrato G2. Sintaxe de todos os JavaScript/CJS deste pacote verificada.

**PostgreSQL 18.3: 26 verificações PASS**, em cluster novo, porta aleatória e loopback. Todas as migrações conhecidas até 045 foram verificadas pelos mecanismos existentes; o pacote 046/047 foi validado por admissão própria. Foram provados replay, rollback integral, recusa de ledger/ACL/trigger alterados, round-trip exato de valores financeiros, preservação do original, gerações e concorrência, aprovação/revogação, contas limitadas e bloqueio de conflitos. A base isolada terminou QUIESCED, sem funding runs. Não houve recolhas externas. Todos os clusters próprios foram encerrados.

As provas são reproduzíveis pelo launcher próprio; não são uma auditoria da base habitual nem um ensaio de carga. Nenhum teste de frontend/build foi necessário porque não houve alterações à UI. Os sete testes ignorados não contam como sucesso.

## Autorrevisão

Revisão feita pelo próprio autor, não independente. Veredicto: **pronto para fechar neste âmbito isolado**.

1. Corrigido o período financeiro que anteriormente era serializado com aspas adicionais.
2. Corrigido o tratamento do zero sem explicação e acrescentadas regressões para dotações partilhadas/qualificadores. Mantida a precisão textual de valores com 24 dígitos e 8 casas decimais.
3. Impedida a reativação de uma geração com aprovação entretanto revogada; acrescentada prova de concorrência entre publicação e revogação.
4. A fonte de teste criada pela migração042 inicia-se ACTIVE. A primeira tentativa de inserir o snapshot foi corretamente recusada; a preparação passou a executar as transições SUSPEND_REQUESTED e QUIESCED, com os triggers intactos. Nenhuma fonte habitual foi consultada ou alterada.
5. A verificação045 recusou as novas permissões do proprietário, como esperado. A diferença foi inspecionada (apenas dois grants), medida e admitida no pacote isolado. Não se relaxaram fingerprints ou testes operacionais.
6. Um primeiro caso sintético de conflito tinha formato inválido; foi corrigido para o contrato v2 (duas evidências, sem campo alternatives). O schema existente não foi alterado. As medições de fingerprints antes de fixar a assinatura não contam como validações finais.

## Limites e condições da etapa seguinte

- Aprovação SQL prova separação de contas e vínculos, não autorização humana OIDC. A ligação ao ator humano, membership central, serviço de auditoria e política de aprovação do GCNI continua obrigatória antes de ativar qualquer escritor operacional. O aprovador é uma fronteira de confiança; Ajv/semântica pertencem ao módulo e não são executados por PostgreSQL.
- O pacote permanece exclusivo de ensaio. O serviço futuro terá de admitir explicitamente o novo estado, incluindo a assinatura do esquema e privilégios. Não adicionar permissões ao leitor existente nem executar estes SQL manualmente na base habitual.
- Não foram implementados snapshots HTTP, expiração de tokens, filtros, ordenação, paginação, permissões de utilizadores/organizações ou interface. Não se afirma prova de isolamento multi-tenant/OIDC por estes testes de roles SQL.
- Não existe rollback destrutivo de dados aceites: falha de instalação reverte a transação; após instalação, correção deve ser incremental e preservar histórico. Gerações não são apagadas automaticamente.

Próximo passo: implementar o serviço de leitura no ambiente isolado, usando a admissão do novo esquema e o contrato G1, com snapshots, paginação, expiração e autorização de leitura por membership, mantendo o escritor operacional e as fontes inativos.
