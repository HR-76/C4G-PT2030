# Pacote registado e preparação da janela 11145

31/10/2026. **Review: preparação concluída e validada; instalação e aceitação habituais pendentes.**

O pacote final foi registado com seleção explícita. O preview foi renovado sobre a API oficial e a revisão habitual. Foi executada uma pausa local delimitada, com backup próprio, restauro lógico isolado e retoma saudável. Central035/tenant033, configuração, UUID/revisão da11145 e dados de negócio foram preservados.

[Contrato](../../references/opportunity-v2/registration-window-11145-contract.md), [descritor final](../../references/opportunity-v2/registered-window-11145.json), [plano de execução e recuperação](../../references/opportunity-v2/window-11145-runbook.md) e [resumo verificável](../../../output/opportunity-v2-window/validation-summary.json).

## Registo e compatibilidade

Pacote `opportunity-v2-activation-11145`, digest `4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a`. Registo executável em `backend/src/security/opportunityV2MigrationPackage.js`, com Central036–042 e tenant034, capacidade `APPLICATION_OPPORTUNITY_SNAPSHOT_V2`.

Os manifestos predefinidos continuam035/033. O pacote exige seleção explícita e a baseline exata; não é instalado no arranque. O migrador central aplica os sete passos numa transação e recusa runtime intermédio036–041. O runner tenant publica a capacidade apenas após prova válida, sem rebaixar o alvo num replay normal. Os SQL mantêm os bytes anteriormente medidos.

Admissão normal, autoridade, metadados tenant e consumidores comuns reconhecem042/034. O leitor aceita as cinco projeções v2 apenas após admissão física042; exige proprietário correto e SELECT sem GRANT OPTION. A baseline mantém as três tabelas anteriores. Escritas, privilégios diretos excessivos e execução SECURITY DEFINER continuam recusados.

O [ensaio final do pacote](../../../output/opportunity-v2-registered-61e834cd2ad74d1484de4e1c40928342/verification.json) passou **12 controlos**, com **388 hashes estáveis**, **9 eventos de auditoria íntegros** e limpeza confirmada. Prova migração normal, rollback, replay, preservação de prefixos/dados/vínculos, login físico de autoridade, sete escritas coordenadas APPLIED, sessões/touch/rotação/revogação, leitores reais e isolamento RLS. Não usa bypass de admissão. O arquivo da chamada neste gate é uma fixture normativa, não uma recolha habitual.

## Preview real atualizado

[Preview e comparação](../../../output/opportunity-v2-window/preview-3bec3a40-a795-4752-a5ac-a378ae787fdf/habitual-preview.json), [resposta oficial preservada](../../../output/opportunity-v2-window/preview-3bec3a40-a795-4752-a5ac-a378ae787fdf/official-response.json) e [página oficial](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/11145).

Consulta limitada a `CASCADE:11145` em **2026-10-31T01:28:19.554Z**: HTTP200, um resultado,20580 bytes. SHA-256 `f66977fa509f025b28f2e059909baac1d35a720a484a0d15f400c31f121e2110`. Comparação factual com S0: **UNCHANGED**, sem conflitos nem campos alterados; digest canónico `355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6`.

| Elemento | Resultado |
| --- | --- |
| Dotação total extraída | ✅ Valor canónico `120000`, confirmado na nova observação |
| Moeda da dotação | ⚠️ `NOT_FOUND`; a moeda EUR do apoio mensal não é transferida para o total |
| Projeto e calendário | ✅ SUSA, acordo `101190010`, sete cut-offs preservados |
| Identidade habitual | ✅ `01a14a80-9143-7177-ba86-9fa72d09fb64` |
| Revisão/CAS | ✅ `01a184d1-0c76-714d-bff6-b141fd140159`, rowVersion4 |
| Correções/resoluções protegidas | ✅ Zero/zero, sem alteração |
| Catálogo habitual | ✅ 538 oportunidades, todas ainda v1 |
| Candidaturas/interesses/oportunidades/documentos privados verificados | ✅ Quatro agregados vazios, checksums preservados |
| Resultado da reconciliação | ⚠️ `CHANGE_REQUIRES_APPROVAL`; nenhuma aprovação ou aceitação habitual produzida |

O valor120000 está capturado no novo artefacto v2 de preparação. A revisão aceite habitual continua a anterior v1 e **não recebeu esse valor por esta entrega**. Um preview local não substitui arquivo durável, aprovação autenticada ou persistência de uma nova revisão.

## Backup, restauro e retoma

[Janela final](../../../output/opportunity-v2-window/window-87ab4ccd-2822-40f5-957f-fb8e4d68bfc8.json), [prova de backup/restauro](../../../output/opportunity-v2-window/87ab4ccd-2822-40f5-957f-fb8e4d68bfc8/backup-restore-47147a0a-8f46-4241-bed8-e2439ecb6403.json) e [verificação após retoma](../../../output/opportunity-v2-window/post-resume.json).

Pausa registada: **01:28:25.165–01:29:22.387 UTC**,57,222 segundos. Backup/restauro:32,980 segundos. Antes da paragem foram verificados árvore de processos, portas, filas Central/tenant e admissões; durante a cópia não existiram sessões externas. A API, o worker e as admissões retomaram com saúde confirmada, novamente verificada às01:30:13.187Z.

Cópia própria preservada em `.tmp/local-platform/opportunity-v2-backup-47147a0a-8f46-4241-bed8-e2439ecb6403`, com ACL limitada ao utilizador e SYSTEM. Inclui dumps, inventários privados por hash, roles sem passwords, sete ficheiros de configuração e suplemento de ACLs do restauro. Segredos/configurações não são transcritos no relatório.

| Base | Tabelas | Linhas | Dump | Resultado |
| --- | ---: | ---: | ---: | --- |
| Central035 | 74 | 40670 | 10736935 bytes | ✅ Dados, sequências, esquema e preflight iguais |
| Tenant033 | 142 | 12779 | 2208308 bytes | ✅ Dados, sequências, esquema e preflight iguais |

Foram verificadas **216 tabelas** e53449 linhas, roles/memberships, propriedades das bases e configuração. O restauro tenant aplicou o suplemento exato das16 ACLs do proprietário, com fingerprint final idêntico. Ausência de drift na origem comprovada durante a pausa. O cluster PostgreSQL18 nativo usou diretório próprio e porta efémera loopback, e foi encerrado; não houve restauro sobre bases habituais.

Esta é uma prova de **restauro lógico**, não de autenticação dos serviços num novo destino. Os segredos dos logins terão de ser repostos a partir da configuração privada e testados antes de uma recuperação operacional/troca de bindings. OIDC e armazenamento externo não foram restaurados. As durações medidas não constituem RTO de produção. Após retoma, qualquer alteração exige renovar a consistência e os backups na janela de instalação.

## Correções e validação

A revisão corrigiu a verificação prévia de trabalho no tenant e nas admissões, e a libertação de todas as ligações mesmo quando um rollback falha. As1211 projeções históricas QUEUED foram preservadas: só são consideradas concluídas quando correlacionadas com outbox e run funding terminal exatos. Trabalho ativo, órfão ou desconhecido impede a pausa; isto foi provado também em PostgreSQL real.

A primeira suite identificou32 fixtures que ainda modelavam apenas o manifesto predefinido; foram adaptadas à dependência registada, mantendo os testes de drift. O gate real identificou o leitor que não reconhecia os cinco SELECT v2; a correção foi condicionada à admissão042 e revista independentemente.

A [primeira tentativa de backup](../../../output/opportunity-v2-window/window-496c81d1-e6ee-427e-bcd6-ffab6096c1aa.json) parou porque `inet::text` devolve um endereço IPv4 com `/32`. O helper passou a reconhecer exclusivamente o mesmo host `127.0.0.1/32`, mantendo recusa de outros CIDRs/IPv6 e validação de diretório/porta. Regressão RED→GREEN; nessa tentativa a aplicação retomou em36,520 segundos e o cluster foi encerrado. Dumps e relatórios falhados foram preservados. O novo gate e a segunda janela passaram com os bytes corrigidos.

Resultado final: **backend2141 PASS/0 FAIL/7 SKIP**, **frontend491 PASS**, build PASS, **41 ficheiros com sintaxe validada**. Revisões independentes sem bloqueantes conhecidos no âmbito. Os16 artefactos S0, Excel original/fixture de177 linhas e124 ficheiros SQL da prova anterior mantêm os hashes. Os manifestos/código de admissão foram alterados deliberadamente; não se afirma que todos os ficheiros da baseline de código permaneceram iguais.

## Condições para a fase de execução

O [runbook](../../references/opportunity-v2/window-11145-runbook.md) fixa pacote, ordem, pré-condições, CAS, aprovação, quiescência, recuperação e retoma. A instalação habitual e a aceitação não foram executadas, e o preview não constitui aprovação administrativa.

Antes da aceitação, falta ligar e ensaiar o executor delimitado à11145: o worker habitual ainda não injeta `canonicalV2Enabled`/`candidateArchive`. A flag de aprovação/suspensão não cria esse arquivo. Exigir observação real, run completo, arquivo revalidado, plano/digest aprovado e fences atuais; não usar fixtures nem promover o ficheiro local diretamente a plano aprovado. Depois da primeira aceitação EUv2, não retomar o writer legado EU.

Novos tenants continuam no alvo predefinido033 até seleção/publicação explícita de034. A verificação histórica parcial F12 em021–033 permanece fora deste incremento; o ramo034 valida o conjunto completo. Portugal2030 documental/API e POCTEP10 mantêm as pendências anteriores, sem nova importação do Excel.

Próximo passo: preparar e ensaiar o executor operacional limitado à11145 para a instalação, arquivo canónico e aceitação com aprovação autenticada, seguindo o runbook e renovando a prova da janela.
