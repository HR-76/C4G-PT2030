# Quota documental por organização

Estado: In Progress — contrato inicial; implementação e validação pendentes.

## Objetivo

Limitar a 10 GiB (10 737 418 240 bytes) o armazenamento documental reservado por organização, incluindo versões antigas e documentos em quarentena. A autorização e o isolamento existentes mantêm-se obrigatórios.

## Critérios de aceitação

- Cada intenção nova reserva o tamanho declarado, incluindo uploads ainda não concluídos. Um replay idempotente não cria nova reserva.
- A admissão e a reserva são atómicas entre pedidos e processos, na base tenant; documentos existentes são contabilizados antes da admissão. Nenhuma migração elimina dados.
- Versões antigas, quarentena e estados cujo armazenamento físico não esteja comprovadamente libertado contam para a quota. A libertação exige prova de eliminação física e política própria; não presumir que um estado lógico libertou espaço.
- Organizações são isoladas, pedidos acima do limite são recusados com resposta compreensível, e falhas não deixam reservas parciais.
- Testes demonstram limite exato, excesso, concorrência, replay, isolamento, dados existentes e rollback. A validação PostgreSQL usa somente infraestrutura descartável explicitamente autorizada; não aplicar migrações às bases habituais nem fazer deploy.

## Evidência e limites

A configuração observada no repositório inclui limites por ficheiro e concorrência por processo, não uma quota acumulada distribuída. O estado efetivo da implantação e do R2 não foi consultado. O runbook de 02/11/2026 regista ausência de conta Cloudflare nessa data e não comprova o estado atual. O contador deve ser conservador relativamente a objetos órfãos e falhas de transporte; reconciliação com o fornecedor permanece necessária para provar o consumo físico total.
