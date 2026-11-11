# Defeito no contador de CPU Windows da primeira série

Durante a primeira série, o observador devolveu CPU de fundo zero em todas as amostras, apesar de observar mais de 200 processos. Uma leitura independente de processos interativos encontrou incrementos fracionários reais. A inconsistência foi investigada sem alterar o SLO ou eliminar medições.

Reprodução mínima no PowerShell usado pelo runner:

```powershell
$map=@{1=[double]10}
$value=[double]10.125
[Math]::Max(0,$value-$map[1])                 # 0, System.Int32
[Math]::Max([double]0,[double]($value-$map[1])) # 0.125, System.Double
```

A resolução do overload com a expressão não tipada escolhe a variante inteira. Os pequenos incrementos por processo eram arredondados antes da soma. O número de processos observados e a presença de amostras não detetavam essa perda.

Consequência: a primeira série não pode comprovar os critérios de interferência Windows. Manter os tempos HTTP, SQL, admissão e a violação observada do máximo de 4 s na execução 8 como evidência; não transformar esta série em PASS do ambiente. O defeito é do novo observador, não do runtime da aplicação nem das validações de autoridade.

Correção prevista após terminar a série ativa: explicitar os dois argumentos como double, marcar versão do contador, testar incrementos fracionários e uma amostragem real com atividade conhecida. Repetir todos os doze bursts na mesma ordem AB/BA, com nomes novos e o SLO aprovado intacto. Guardar as fontes da primeira execução antes de corrigir. A repetição é justificada pela falha da instrumentação; não selecionar amostras favoráveis da primeira série.


Corre??o e repeti??o integral conclu?das: [resultado final](../c6-dedicated-slo-repeat/README.md). As fontes executadas da primeira s?rie est?o em attempt1-sources/. Teste fracion?rio e amostragem real PASS; contador fractional-double-v2 na repeti??o.
