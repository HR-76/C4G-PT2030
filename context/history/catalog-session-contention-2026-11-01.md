# Resultado e autorrevisão — esperas e sessões — 01/11/2026
Estado: Review; carga NOT_ACCEPTED. Baseline df43e9960cfa42dda26480e5254cd192 e final 323ba139fbdf412c95483a5835e74e7f. Sem promoção ou fontes.

Medição de pool, admissão, lock, verificação sob lock e renovação completa (inclui trabalho após cabeçalhos). Janelas separadas de preparação/aquecimento; amostras brutas sem identidades, zero perdas. Baseline 27: 50 renovações para 50 pedidos por percurso; 119–127 ms médios, admissão 85–91 ms, lock 11 ms e get/validate/set aproximadamente 4–5 ms. O custo dominante não era a escrita isolada nem apenas o bloqueio.

Correção: juntar apenas renovações autenticadas idênticas (SID e auth integral) ainda pendentes de admissão/lock. Grupo fecha antes da leitura e validação atuais. Nenhum resultado concluído, decisão de acesso ou snapshot de segurança é guardado. Máximo 256 grupos pendentes; anónimos, legado, auth diferente e saturação mantêm percurso original. Falhas chegam a todos, grupos removidos, dados atuais preservados. Escritas continuam exclusivas e prazo idle nunca ultrapassa o absoluto/físico. Opção explícita requer capacidade isolada genuína; omissão mantém comportamento habitual.

Resultados por cenário (valores ms):
[
  {
    "volume": 27,
    "route": "list",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 70.45,
    "readPoolMeanMs": 31.07,
    "readAdmissionMeanMs": 118.17,
    "renewalAdmissionMeanMs": 81.5,
    "renewalLockMeanMs": 0.46,
    "worstServerP95Ms": 660.54,
    "worstHttpP95Ms": 767.85,
    "seriesP95Ms": [
      660.54,
      631.87,
      654.63,
      640,
      627.54
    ]
  },
  {
    "volume": 27,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 69.08,
    "readPoolMeanMs": 32.57,
    "readAdmissionMeanMs": 123.76,
    "renewalAdmissionMeanMs": 79.22,
    "renewalLockMeanMs": 0.55,
    "worstServerP95Ms": 651.63,
    "worstHttpP95Ms": 765.52,
    "seriesP95Ms": [
      651.63,
      625.84,
      605.94,
      627.03,
      616.47
    ]
  },
  {
    "volume": 10000,
    "route": "list",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 67.13,
    "readPoolMeanMs": 29.72,
    "readAdmissionMeanMs": 113.1,
    "renewalAdmissionMeanMs": 78.26,
    "renewalLockMeanMs": 0.5,
    "worstServerP95Ms": 650.57,
    "worstHttpP95Ms": 755.44,
    "seriesP95Ms": [
      633.2,
      603.07,
      640.98,
      611.72,
      650.57
    ]
  },
  {
    "volume": 10000,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 65.27,
    "readPoolMeanMs": 30.11,
    "readAdmissionMeanMs": 116.81,
    "renewalAdmissionMeanMs": 75.48,
    "renewalLockMeanMs": 0.45,
    "worstServerP95Ms": 606.09,
    "worstHttpP95Ms": 711.23,
    "seriesP95Ms": [
      593.42,
      583.96,
      582.69,
      568.9,
      606.09
    ]
  }
]

Contagens conferidas: em cada cenário, 50 leituras de sessão admitidas e 50 conclusões de touch; renovações executadas+participantes agrupados=50. Cada renovação efetiva consulta a sessão atual e valida revogação; cada pedido mantém a sua autorização/membership fresca. 200 medições e 40 aquecimentos sem erros. Percentis recomputados, meta 500 ms preservada. Tempos HTTP completos separados de tempos até cabeçalhos. Ensaios sequenciais locais, não comparação aleatória nem SLA.

Testes: backend 2490 PASS/7 SKIP/0 FAIL; frontend 580 PASS/build PASS; PostgreSQL 36 PASS; aceitação funcional PASS. Regressões executadas antes da correção; incluem default separado, grupos incompatíveis, chegada durante validação, falha/retry, revogação/deleção/expiração, dados atuais, limite de grupos e recusa fora do isolado. Instrumentação tolera falhas síncronas/assíncronas do observador sem substituir o resultado.

Autorrevisão: identificado e corrigido um detalhe na cópia de auth: JSON podia normalizar campos e alterar a igualdade estrita. Regressão adicionada antes da correção; structuredClone preserva os valores e os campos, incluindo undefined. Suite completa e carga final repetidas depois deste ajuste. A primeira carga com agrupamento (bd9a9203048e4d8183136c3d5c8d0f6e) é intermédia, não a evidência final. Redução comprovada de renovações duplicadas, sem regressão de segurança identificada no âmbito alterado. Desempenho ainda não aceite se qualquer série exceder 500 ms; não confundir 50 callbacks com 50 escritas nem aprovação funcional com capacidade. O custo restante de admissão por pedido exige novo trabalho; não removido para alcançar um número. OIDC/Keycloak local sintético, primário único, admin/lista padrão e ficha; sem certificação de federação externa, HA ou outros workloads. Recursos próprios limpos, exposição OFF.

Próximo passo: otimizar as consultas de admissão do esquema e das permissões, mantendo a validação fresca por pedido, e repetir a carga isolada.
