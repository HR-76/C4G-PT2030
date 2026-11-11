# GCNI — reposição da referência validada — 02/11/2026
Estado: Complete nesta reposição. A melhoria global de desempenho permanece por aprovar.

## O que foi reposto
Os quatro ficheiros de runtime foram repostos byte a byte à referência anterior a C1/C2, validada na execução9dfce593bfaf409ca0bc087b78930460: catalogConstraintQuery.js, centralSchemaManifest.js, isolatedAdmission.js e readSchema.js. Hashes preservados em reference.json/validation.json. Não é uma reposição de todas as otimizações anteriores: transporte compacto e leitura direta conservadora de conenforced permanecem como nessa referência.

Removida do runtime a reutilização local da versão C1 e o agrupamento C2. A versão volta a ser consultada nos pontos anteriores e os guardas antecedem a consulta separada do fingerprint. Sem alterações aos bloqueios, transações, hashes, ledger, permissões ou checkpoints finais. Sem mudanças de migrações, fontes ou configuração habitual.

## Preservação dos testes e evidências
Código rejeitado preservado em backend/test/support/c1c2Rejected.json com proveniência/hashes. Os três testes unitários C1/C2 continuam executáveis, identificados explicitamente como históricos e carregados por um auxiliar exclusivo de testes. Não são apresentados como provas do runtime reposto. Os seis testes dos guardas continuam a verificar os mesmos erros e a impedir avanço para metadados/dados protegidos após recusa, agora no percurso separado.

Três regressões adicionais comprovam observação fresca da versão, não aceitação de opções antigas como substituto dessa observação e recusa do comparador histórico quando o runtime não coincide com o candidato avaliado. O comparador de carga A/C1/C2 não pode executar silenciosamente sobre esta reposição. Nenhum teste foi ignorado para produzir aprovação.

## Validação da reposição
Regressões executadas antes da alteração e falharam como esperado. Testes dirigidos e suite completa após reposição:2508 PASS,7 SKIP,0 FAIL; o total inclui3 testes unitários do candidato arquivado. Frontend580 PASS e build PASS. PostgreSQL próprio:36 verificações do gate,10 provas de equivalência/drift e8 provas específicas de reposição, todas aprovadas.

As provas específicas verificam: duas observações da versão por admissão como na referência; nova admissão na mesma ligação; alteração de schema/ACL recusada; nova recolha após recuperação; consultas de guardas e fingerprint separadas; role revogado recusado antes da consulta de projeção; privilégio direto indevido recusado; acesso restaurado somente após nova admissão. Os dados de ensaio foram revertidos e o cluster próprio encerrado.

OIDC local, tabela/ficha, isolamento entre organizações, controlos duráveis, drift de permissões e revogação de membership:PASS. Execução:4a7b1ac342364f50b9eef0c3ee164113.200 medições+40 aquecimentos,27/10000 oportunidades,10 concorrentes,5 séries de10. Sem erros ou violações de contrato. Percentis recalculados, piscinas de ligações e meta500ms inalterados.
[
  {
    "volume": 27,
    "route": "list",
    "renewals": 16,
    "joined": 34,
    "renewalMeanMs": 63.83,
    "readPoolMeanMs": 27.86,
    "readAdmissionMeanMs": 106.5,
    "renewalAdmissionMeanMs": 73.35,
    "renewalLockMeanMs": 0.51,
    "worstServerP95Ms": 603.58,
    "worstHttpP95Ms": 712.25,
    "seriesP95Ms": [
      565.62,
      576.97,
      565.87,
      603.58,
      594.72
    ]
  },
  {
    "volume": 27,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 65.84,
    "readPoolMeanMs": 28.49,
    "readAdmissionMeanMs": 109.58,
    "renewalAdmissionMeanMs": 74.58,
    "renewalLockMeanMs": 0.72,
    "worstServerP95Ms": 589.12,
    "worstHttpP95Ms": 698.26,
    "seriesP95Ms": [
      558.08,
      571.17,
      549.27,
      584.79,
      589.12
    ]
  },
  {
    "volume": 10000,
    "route": "list",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 61.2,
    "readPoolMeanMs": 29.09,
    "readAdmissionMeanMs": 111.6,
    "renewalAdmissionMeanMs": 75.18,
    "renewalLockMeanMs": 0.89,
    "worstServerP95Ms": 632.85,
    "worstHttpP95Ms": 714.33,
    "seriesP95Ms": [
      611.48,
      594.74,
      632.85,
      602.5,
      608.22
    ]
  },
  {
    "volume": 10000,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 59.73,
    "readPoolMeanMs": 27.87,
    "readAdmissionMeanMs": 106.65,
    "renewalAdmissionMeanMs": 69.41,
    "renewalLockMeanMs": 0.56,
    "worstServerP95Ms": 559.03,
    "worstHttpP95Ms": 663,
    "seriesP95Ms": [
      543.71,
      554.51,
      528.95,
      538.98,
      559.03
    ]
  }
]

Resultado de capacidade:NOT_ACCEPTED. A reposição é válida mesmo que a referência continue acima500ms; não se atribui ganho de desempenho a uma reposição nem se altera a meta. Comparação temporal com a referência original não é um novo ensaio A/B equilibrado. Tempo de servidor até cabeçalhos e HTTP completo são diferentes.

## Autorrevisão
Conferidos os hashes exatos, o âmbito de quatro ficheiros e a ausência de novos imports de arquivo no serviço. Mantidas as provas de revogação, nova observação na mesma ligação e checkpoints após lock. Corrigido o caminho relativo do carregador de testes históricos; testes repetidos depois dessa correção. Os testes históricos permanecem separados das oito provas reais do código reposto. Não houve alteração de referências de schema para contornar validações.

Conclusão: reposição concluída e validada; capacidade ainda não aprovada. Keycloak local com identidades sintéticas, primário único e carga administrativa não certificam federação externa ou SLA. Compatibilidade integral da projeção PostgreSQL17 continua pendente. Exposição finalOFF, fontesQUIESCED,zero recolhas e recursos próprios limpos. Sem promoção ou ativação no ambiente habitual.

Próximo passo: recolher um perfil de CPU e de esperas da referência reposta para localizar o custo dominante, antes de propor outra otimização.
