# Consolidação EU v2 e protocolo — 31/10/2026

[Contrato](../features/eu-writer-baseline-performance.md), [manifesto da baseline](../references/performance/eu-writer-v2-baseline.json), [protocolo](../references/performance/eu-writer-v2-protocol.md) e [parâmetros](../references/performance/eu-writer-v2-protocol.json).

## Versão consolidada

Identidade `eu-writer-v2-d2898861a25b4f6e`, com 1807 ficheiros de fontes, testes, fixtures, contratos, ferramentas e lockfiles. O manifesto regista versões Node/dependências, SQL043, fingerprints de esquema/permissões e digest do pacote11145 preservado.

Estado final: **CONSOLIDATED_VALIDATED_RESTORED / PASS**. O manifesto externo incorpora os resultados e os seus hashes; a identidade, as fontes, o pacote e os arquivos originais permanecem inalterados.

- Digest das fontes: `d2898861a25b4f6e4dcb7d4ec91cc42830042ea7bdcbeb3efb56ee5adcdea7b3`.
- Digest do pacote EU v2: `2bdae82ddd6516e3b31bf33699f5213adaf6c36ae038a59c59f2123752033ee7`.
- Checksum canónico SQL043: `68562ede29f9c6063105c132331d7defb7b776d6ad5e928b3b1e843925af3f62`.
- [Arquivo de fontes](../../output/eu-writer-baseline-20261031/eu-writer-v2-d2898861a25b4f6e/sources.zip): 15417439 bytes, SHA256 `9f33fc940ce4cb42786cd6938cb2c0ca3037b5dd0d8b7e3323e83688c30eae4b`.

Os 1807 nomes, conteúdos e CRC do ZIP foram verificados com um leitor ZIP independente. A cópia anterior `eu-writer-v2-df0446eabf7694eb` foi conservada como preparação anterior ao reforço do verificador; não é a baseline final.

O arquivo exclui configurações `.env*`, credenciais, dependências instaladas, builds e pastas internas Git. O hash de `backend/.env.example` permanece apenas no inventário de correspondência da prova física; o conteúdo do template não foi arquivado. A reprodução do ambiente exige reconstrução por lockfiles e configuração própria; o arquivo cobre a allowlist declarada e não a totalidade do computador.

## Correspondência da evidência

A [prova isolada final](../../output/opportunity-v2-writer-2da50ff68436466da34be54c00c2c4bf/verification.json) já existente passou 23 verificações em PostgreSQL18.6, com 842 hashes, 111 eventos de auditoria válidos e cleanup confirmado. A preparação conferiu a igualdade integral do inventário do gate com as fontes no momento da captura e o descritor final; não voltou a executar esse gate. Esta correspondência pertence à versão arquivada, não a alterações posteriores no workspace.

| Requisito | Evidência correspondente | Limite |
| --- | --- | --- |
| Instalação explícita043 sobre042, replay e preservação da baseline | Checks `REGISTERED_*` e `EU_WRITER_REGISTERED043_BASELINE_AND_REPLAY`; testes do pacote | Instalação descartável; nenhuma instalação habitual |
| UNCHANGED, alteração segura, perdas e novas identidades | Checks de queue/archive, safe change e durable review; `fundingEuWriter.test.js` | Transporte controlado e atores sintéticos |
| Permits, roles, drift, leases/fences, retry e atomicidade | Checks de helper role/drift, pausa, redelivery, rollback e deadline | Worker com ligação proprietária isolada; helper sob role limitada, sem certificação de login mínimo ponta a ponta |
| CORDIS/Erasmus, Interreg/POCTEP e identidade v2 sem placeholder legado | Três casos adicionais na prova de 23 checks | A prova anterior de 20 checks não cobre estes casos; permanece histórica |
| Leitores, dados tenant e isolamento | Check final dos leitores físicos, v1/v2 e RLS | Sessões sintéticas; não substitui OIDC humano habitual |
| Integridade histórica | 16 artefactos normativos, Excel177 linhas, 148 SQL anteriores; pins036–042 e pacote11145 | Integridade de artefactos; não é leitura atual das bases habituais |
| Frescura e eficiência da recolha de metadados | `authorityMetadataDedup.test.js` e `centralSchemaCatalogBatch.test.js`, incluindo uma consulta base agregada e verificação após lock | Contagem de chamadas e correção; não prova de latência |

## Validação local desta consolidação

Logs em `output/eu-writer-baseline-20261031/`; o manifesto final liga os respetivos hashes.

- Foco writer/pacote/metadados/verificador: **106 PASS / 0 FAIL**.
- Verificador: **12 testes PASS**, incluindo regressões para diferenças de maiúsculas/minúsculas e aliases internos que apontam para caminhos excluídos. As duas regressões falharam antes da correção; aliases internos legítimos continuam permitidos.
- Frontend: **494 PASS**, 63 ficheiros; build Vite **PASS**.
- Sintaxe dos três ficheiros JavaScript novos: **PASS**.
- Suite backend do workspace: **2216 PASS / 0 FAIL / 7 SKIP**. A verificação final encontrou alterações paralelas posteriores à suite, pelo que o intervalo completo não ficou fechado por hashes; a validação da cópia restaurada é registada separadamente para atribuição direta à baseline.

Os sete testes ignorados são provas PostgreSQL de browse/paginação/visibilidade, agregados de reporting/unidades, resumo de oportunidades e pessoas/áreas científicas. Permanecem explicitamente fora da aprovação pela suite local.

A integridade antes dos testes passou. A verificação posterior recusou corretamente a divergência do workspace: a preparação paralela da janela043 alterou `backend/scripts/localPlatform/backupOpportunityV2.js` e `backend/test/opportunityV2Backup.test.js`; a correção paralela do dashboard/tenant034 alterou `backend/src/opportunities/httpComposition.js` e `backend/test/opportunityV2ConsumerAdmission.test.js`. Os horários observados das alterações são posteriores ao fecho do log backend; não demonstram alteração durante a execução dos testes. Os hashes esperados e o ZIP foram preservados. A validação final usa uma restauração nova do arquivo, sem incorporar essas alterações na baseline.

### Reprodução isolada da versão arquivada

Raiz nova `output/eu-writer-baseline-20261031/restored-validation/`, extraída do ZIP intacto. O verificador arquivado passou antes das suites e os 842 hashes do gate coincidiram integralmente, sem ficheiros extra. Os opt-ins para bases externas e `NODE_OPTIONS`/`NODE_PATH` foram removidos apenas do ambiente dos processos de teste.

Os testes exigem cinco entradas públicas adicionais: o template `.env.example`, cujo hash coincide com o inventário original do gate, e quatro ficheiros do tema Keycloak. Ficaram identificados no [manifesto suplementar](../../output/eu-writer-baseline-20261031/public-test-fixtures-supplement.json) e num ZIP separado de 14569 bytes, SHA256 `a933b40d638d377d5876d4c1da9809fb18cabbc4b86ca1e8c73dfa364e96ba57`. Os ficheiros do tema foram recolhidos depois da captura e não integravam os hashes originais; esta proveniência é explícita.

Foram reutilizadas dependências instaladas através de três junctions restritas a `node_modules`; todas as versões declaradas coincidiram com as capturadas. Os lockfiles pertencem à baseline, mas os bytes completos da árvore de dependências não foram arquivados nem certificados. Nenhuma configuração real ou credencial foi copiada.

- Foco: **106 PASS / 0 FAIL / 0 SKIP**, incluindo os 12 testes do verificador.
- Frontend: **494 PASS**, 63 ficheiros; build **PASS**, 10,48 segundos.
- Backend final: **2216 PASS / 0 FAIL / 7 SKIP**, 2223 testes, 51,69 segundos; log `restored-backend-tests-complete.log`.
- Foco dos testes dependentes do segundo suplemento: **92 PASS / 0 FAIL / 0 SKIP**; log `restored-supplement-focused-tests.log`.
- Integridade depois das suites: **PASS** nos 1807 ficheiros, ZIP e SQL; inventário do gate **842 hashes exatos**, 16 inputs suplementares e respetivos ZIPs preservados, versões de dependências coincidentes. [Verificação final](../../output/eu-writer-baseline-20261031/integrity-restored-after.json) e [conferência complementar](../../output/eu-writer-baseline-20261031/restored-runtime-and-gate-after.json).

A primeira suite backend restaurada registou **2154 PASS / 6 FAIL / 7 SKIP**: o arquivo por allowlist não incluía o protótipo histórico `backend/prototypes/partnerSqlPortal.js`, exigido por cinco grupos de testes, nem os dez runbooks de observabilidade, exigidos por um teste de catálogo. O log `restored-backend-tests.log` permanece preservado. Estes 11 inputs foram acrescentados num [segundo suplemento](../../output/eu-writer-baseline-20261031/additional-test-inputs-supplement-v2.json), sem alterar fontes, testes ou expectativas da baseline; a repetição completa passou num log novo. O ZIP suplementar tem 10578 bytes, SHA256 `e5237f12e833fba5ea6598de779478ea1422a6ef7881aa11f6d964ddd2bf5151`. A proveniência posterior à captura e os hashes dos dois suplementos acompanham a reprodução dos 1823 inputs (1807 fontes e 16 entradas suplementares).

Uso local, sem escrita nem infraestrutura:

```powershell
node scripts/verify-eu-writer-baseline.cjs
```

Este comando compara o workspace em que o script reside com a versão fixada e deve recusar as alterações posteriores. Para verificar uma restauração, extrair o ZIP num destino novo, conservar o manifesto externo e o ZIP nos caminhos relativos declarados e executar a cópia arquivada do script nesse destino. O manifesto externo é excluído do arquivo para evitar um digest autorreferente; as dependências são reconstruídas pelos lockfiles ou reutilizadas com proveniência explicitamente registada.

O verificador recusa drift/ausência de fontes inventariadas, escape de paths, alvos excluídos, digest incoerente, ZIP alterado e checksum SQL divergente. É uma verificação de integridade de uma baseline revista: confere os bytes do ZIP por hash, enquanto a correspondência dos seus conteúdos foi verificada separadamente na geração. Ficheiros adicionais não inventariados não são enumerados pelo CLI; a conferência separada do gate verifica a igualdade da sua lista de dependências. Recalcula o digest do pacote a partir do `entry` fixado e confere o JS por hash; não executa o módulo nem substitui a prova física de fingerprints. Não existe atualização automática dos hashes esperados.

## Protocolo preparado

- M: comparação de sete/uma consultas base no mesmo esquema042 ou043, seis pares alternados, 600 amostras por variante/revisão, com igualdade/frescura/segurança exigidas antes da medição.
- H: três réplicas da matriz report/dashboard, 108 tentativas HTTP, dois tenants, métricas de latência, SQL, fila, admissão, locks e drenagem.
- W opcional: 100 oportunidades v2 UNCHANGED por ciclo, seis pares worker inativo/ativo, fixture nova por bloco e 144 tentativas HTTP; sobreposição medida e obrigatória.
- C6: apenas numa regressão de código futura com candidato definido; mantém a política aprovada de admissão, sem a converter em SLO HTTP.

Estado `PREPARED`, com os adaptadores de medição identificados como `ADAPTATION_REQUIRED`. Os harnesses históricos não são apresentados como executáveis para esta baseline. O descritor fixa cargas, métricas, quantis, contagens e limites de controlo; imagens e seed da execução são fixados antes de uma futura carga, após preparar os adaptadores. Nenhuma medição de desempenho ou ganho foi declarado.

Limite de prontidão identificado na revisão: esta versão arquivada precede a [correção da compatibilidade tenant034 no dashboard](../features/organization-dashboard-schema-compatibility.md). O seu `httpComposition.js` ainda não acrescenta `OPPORTUNITY_V2_SCHEMA_VERSION` às versões admitidas para oportunidades privadas. Antes da fase H/043/034, a versão derivada para o ensaio deve incorporar essa correção, fixar novos hashes incluindo os adaptadores e comprovar o percurso HTTP funcional. A prova do writer permanece atribuída aos hashes originais; não certifica automaticamente a composição alterada. Este ponto impede declarar a execução HTTP pronta, mas não altera o estado de protocolo preparado.

Revisão independente sem bloqueantes para a consolidação e preparação do protocolo, com a condição de prontidão acima explícita. Runtime, migrations, pacotes e configurações da aplicação não foram alterados por esta consolidação. Nenhuma infraestrutura, suspensão de serviços, base habitual, commit ou deploy foi executado.
