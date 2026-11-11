# Controlo de faturação C4G — Fase A

Fecho formal: 26/10/2026.

## Resultado entregue

- Conta de faturação versionada, ciclos, documentos fiscais externos, pagamentos, estornos, saldos e timeline na base central.
- Autoridade exclusiva C4G, idempotência, CAS, auditoria F7, valores decimais exatos e datas civis.
- API e interface administrativa com ações calculadas pelo servidor, filtros e paginação.
- Migration `027_platform_billing` instalada no ambiente habitual após backup/restauro e validação dos fingerprints.
- Correção do carregamento lazy da lista e detalhe incluída neste fecho.

## Validação

A revisão formal repetida não encontrou findings bloqueantes ou relevantes. Ficaram registados 89 testes backend, 13 frontend, gate PostgreSQL `000→027`, build e browser PASS; o rollout final acrescentou 76 testes, build e prova do ambiente habitual. Na reconferência de 26/10/2026, a seleção conjunta executou 51 testes backend e 39 frontend com sucesso.

A suite frontend global atual executou 52 ficheiros/314 testes com sucesso e parou num erro de sintaxe de `EntityAdmission.jsx`, pertencente ao trabalho de adesão ainda ativo. O build atual é interrompido pelo mesmo ficheiro; esta regressão externa não reabre a Fase A, cujos builds e provas integrais já tinham passado.

## Limites preservados

Não inclui emissão fiscal, integração TOConline/FE-AP, PDF/R2, Resend/SMTP, cobrança automática, reconciliação bancária, portal do cliente ou suspensão por incumprimento.

[Contrato e evidência completos](../features/platform-billing-control-phase-a.md).
