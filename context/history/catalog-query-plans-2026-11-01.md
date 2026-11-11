# GCNI — custo das verificações PostgreSQL: resultado e autorrevisão
Estado: Review. Funcional PASS; carga NOT_ACCEPTED. Sem promoção ou fontes.

Alteração: percurso isolado usa leitura direta de COALESCE(con.conenforced,false) no PostgreSQL18 em vez de converter toda a linha pg_constraint para JSONB. A versão é observada em cada checkpoint pelo preflight existente;17 mantém a consulta original; versões desconhecidas são recusadas. Nada é guardado entre pedidos. Todas as restantes colunas, joins, filtros, ordenações, hashes, locks, ledger e membership ficam iguais. O comportamento por omissão permanece inalterado. Planos preparados tiveram ganho variável e não foram ativados.

Comparação SQL alternada de12 pares, A=referência e B=leitura direta, mediana ms (EXPLAIN ANALYZE, fora da carga): {"nativeReviewed": {"A": 26.447, "B": 21.339}, "finalContainer": {"A": 36.709, "B": 31.114}}. O ensaio nativo final reduziu26,447→21,339ms. Isto mede execução da consulta, não latência HTTP nem capacidade produtiva. A versão é consultada adicionalmente; a carga completa inclui esse custo. A comparação nativa final decorreu durante testes de correção e não é evidência de capacidade; a comparação no contentor final decorreu depois da carga e sem as suites.

Carga: referência 76406f9580dd4dbd8046364ec62fb98b; final 9dfce593bfaf409ca0bc087b78930460.27/10000 oportunidades, tabela/ficha,10 concorrentes,5 séries de10 por cenário,40 aquecimentos.200 medições sem erros ou violações de contrato. Percentis recalculados das amostras; meta500ms por série não alterada. Servidor até cabeçalhos e HTTP completo são medidas distintas. Comparação sequencial local, não atribuição causal rigorosa.
[
  {
    "volume": 27,
    "route": "list",
    "renewals": 16,
    "joined": 34,
    "renewalMeanMs": 65.42,
    "readPoolMeanMs": 28.44,
    "readAdmissionMeanMs": 107.73,
    "renewalAdmissionMeanMs": 77.47,
    "renewalLockMeanMs": 0.5,
    "worstServerP95Ms": 627.62,
    "worstHttpP95Ms": 732.84,
    "seriesP95Ms": [
      603.76,
      627.62,
      619.35,
      599.35,
      585.5
    ]
  },
  {
    "volume": 27,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 59.98,
    "readPoolMeanMs": 28.66,
    "readAdmissionMeanMs": 109.05,
    "renewalAdmissionMeanMs": 70.4,
    "renewalLockMeanMs": 0.48,
    "worstServerP95Ms": 559.79,
    "worstHttpP95Ms": 664.17,
    "seriesP95Ms": [
      555.13,
      559.79,
      533.1,
      557.72,
      541.13
    ]
  },
  {
    "volume": 10000,
    "route": "list",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 64.21,
    "readPoolMeanMs": 28.18,
    "readAdmissionMeanMs": 107.3,
    "renewalAdmissionMeanMs": 76.71,
    "renewalLockMeanMs": 0.49,
    "worstServerP95Ms": 625.56,
    "worstHttpP95Ms": 741.51,
    "seriesP95Ms": [
      584.36,
      625.56,
      618.68,
      602.3,
      597.65
    ]
  },
  {
    "volume": 10000,
    "route": "detail",
    "renewals": 15,
    "joined": 35,
    "renewalMeanMs": 59.52,
    "readPoolMeanMs": 29.16,
    "readAdmissionMeanMs": 113.62,
    "renewalAdmissionMeanMs": 70.67,
    "renewalLockMeanMs": 0.55,
    "worstServerP95Ms": 572.67,
    "worstHttpP95Ms": 666.8,
    "seriesP95Ms": [
      543.54,
      562.75,
      544.67,
      565,
      572.67
    ]
  }
]

Fases médias ms, incluem espera e podem sobrepor-se: [{"volume": 27, "route": "list", "meanMs": {"auth": 165.24, "membership": 21.32, "controls": 15.74, "read": 231.67}}, {"volume": 27, "route": "detail", "meanMs": {"auth": 164.57, "membership": 12.88, "controls": 20.1, "read": 202.8}}, {"volume": 10000, "route": "list", "meanMs": {"auth": 164.65, "membership": 20.12, "controls": 15.44, "read": 228.49}}, {"volume": 10000, "route": "detail", "meanMs": {"auth": 168.7, "membership": 13.95, "controls": 21.7, "read": 203.79}}].

Validação:2500 backend PASS,7 SKIP,0 FAIL;580 frontend PASS e build PASS;36 verificações do gate PostgreSQL18 e10 provas de igualdade e drift aprovadas. OIDC local e18 verificações funcionais/execução aprovadas. Regressões falharam antes da implementação; versão suportada consultada em todas as chamadas,17 mantém SQL exato, versões inválidas recusadas, transformação ambígua recusada e NOT NULL não canónico rejeitado. Provas reais detetam alterações de tabela/coluna/role/grants/função e nova definição na mesma ligação; alterações de ensaio revertidas.

Autorrevisão: preservado o COALESCE(...,false), incluindo tratamento conservador de nulos. Regressão executada antes do ajuste; testes focados, suite completa de backend, gate real e carga repetidos depois. Corrigido um dado do teste de frescura: NOT NULL canónico é intencionalmente normalizado para fora da lista; a prova usa CHECK para observar uma nova entrada e mantém uma prova separada de rejeição NOT NULL. Não se alterou a regra para satisfazer o teste. Nenhuma regressão de segurança identificada no âmbito alterado. Aceitação de capacidade depende do resultado da carga, não da redução SQL.

Limitações: Keycloak local com identidades sintéticas, primário único, carga admin; não certifica federação externa ou SLA. Caminho17 validado por igualdade de SQL em teste unitário, não por novo ensaio integral; incompatibilidade da projeção já registada no incremento anterior permanece pendente. Recursos próprios limpos, exposição OFF. Nenhuma fonte ou ambiente habitual ativado.

Na ferramenta de diagnóstico, o ensaio pós-carga avisou que nomes de planos experimentais excediam63 caracteres. Os três nomes permaneceram distintos e as provas de igualdade passaram. Encurtados apenas esses nomes e acrescentada asserção do limite; gate e diagnóstico isolados repetidos sem avisos. O serviço não usa planos preparados e não foi alterado após a carga final. Esta correção do harness não altera as amostras guardadas.

Próximo passo: avaliar a consolidação das admissões dentro de cada pedido, identificando quais podem partilhar o mesmo checkpoint sem atravessar bloqueios ou reutilizar decisões entre pedidos, antes de implementar nova otimização.
