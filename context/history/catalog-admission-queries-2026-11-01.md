# Consultas de admissão — resultado e autorrevisão
Estado: Review. Funcional PASS; carga NOT_ACCEPTED. Sem promoção ou reativação de fontes.

Otimização aplicada exclusivamente ao percurso isolado: linhas do catálogo transportadas como listas de valores; definições de funções enviadas uma vez por função. Reconstrução dos mesmos objetos ordenados antes das verificações e hashes existentes. Sem cache de metadados ou decisões; sem alteração de fingerprints, migrações, grants, locks, ledger, membership ou limites de pool.

Prova em PostgreSQL18: 36 verificações do gate e10 provas adicionais. Igualdade exata de JSON e fingerprint de referência; deteção de alterações de colunas, constraints, grants de relação/coluna, roles e definições de funções, incluindo nova alteração na mesma ligação. Rejeição de NOT NULL não canónico e preservação da normalização canónica. Mutação de ensaio revertida em cada caso.

Redução de representação JSON, sem contar protocolo: catálogo762809→495223bytes (-35,1%); autoridade291365→208205bytes (-28,5%). Valores de diagnóstico nativo, não volume total da rede. Variantes de SQL, junções e hashes na base não mostraram ganho consistente e não foram aplicadas ao runtime. Não atribuir causalidade aos tempos sequenciais locais.

Carga comparada com 323ba139fbdf412c95483a5835e74e7f; final 76406f9580dd4dbd8046364ec62fb98b.200 medições,40 aquecimentos,10 concorrentes,5 séries por cenário. Percentis recomputados das amostras;zero erros/contratos inválidos. A meta p95<=500ms por série não foi alterada. Tempos do servidor até cabeçalhos e HTTP completo separados. Resultado:
[
  {
    "volume": 27,
    "route": "list",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 62.34,
    "readPoolMeanMs": 28.32,
    "readAdmissionMeanMs": 109.27,
    "renewalAdmissionMeanMs": 73.86,
    "renewalLockMeanMs": 0.78,
    "worstServerP95Ms": 601.35,
    "worstHttpP95Ms": 708.24,
    "seriesP95Ms": [
      560.17,
      577.27,
      601.35,
      594.74,
      591.77
    ]
  },
  {
    "volume": 27,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 65.28,
    "readPoolMeanMs": 32.68,
    "readAdmissionMeanMs": 127.31,
    "renewalAdmissionMeanMs": 75.83,
    "renewalLockMeanMs": 0.45,
    "worstServerP95Ms": 664.16,
    "worstHttpP95Ms": 767.48,
    "seriesP95Ms": [
      664.16,
      574.87,
      575.09,
      582.98,
      582.09
    ]
  },
  {
    "volume": 10000,
    "route": "list",
    "renewals": 17,
    "joined": 33,
    "renewalMeanMs": 77.68,
    "readPoolMeanMs": 29.71,
    "readAdmissionMeanMs": 114.88,
    "renewalAdmissionMeanMs": 80.76,
    "renewalLockMeanMs": 0.46,
    "worstServerP95Ms": 659.05,
    "worstHttpP95Ms": 765.99,
    "seriesP95Ms": [
      659.05,
      646.26,
      634.39,
      651.41,
      628.64
    ]
  },
  {
    "volume": 10000,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 68.96,
    "readPoolMeanMs": 31.76,
    "readAdmissionMeanMs": 122.54,
    "renewalAdmissionMeanMs": 84.35,
    "renewalLockMeanMs": 0.52,
    "worstServerP95Ms": 670.26,
    "worstHttpP95Ms": 782.36,
    "seriesP95Ms": [
      632.62,
      648.65,
      670.26,
      604.73,
      629.57
    ]
  }
]

Testes:2496 backend PASS,7 SKIP,0 FAIL;580 frontend PASS;build PASS;14 ficheiros JS/CJS com sintaxe válida. Regressões executadas antes da implementação. Autorrevisão identificou carga precoce do módulo incompatível com o harness e OID serializado como texto no PostgreSQL real. Corrigidos com importação apenas no percurso compacto e conversão SQL explícita para bigint; o descodificador não foi flexibilizado. Suites e carga repetidas após a correção.

Conclusão: sem regressão de segurança identificada no âmbito alterado, mas desempenho ainda por aprovar; redução de bytes não comprova por si só menor latência. PostgreSQL17 adicional recusado por CATALOG_READ_SCHEMA_OR_PERMISSION_DRIFT na admissão da projeção (consulta não alterada neste incremento); a compatibilidade não está certificada e a causa completa não foi investigada nesta fase. Nenhuma referência foi alterada para contornar a recusa. Keycloak local, contas sintéticas e primário único não comprovam federação institucional externa ou SLA de produção. Recursos próprios limpos e exposição OFF.

Próximo passo: reduzir o custo de execução das verificações do catálogo PostgreSQL, com comparação controlada antes/depois e a mesma validação por pedido, e repetir a carga isolada.
