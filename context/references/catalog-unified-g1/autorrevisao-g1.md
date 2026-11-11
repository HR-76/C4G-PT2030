# G1 — autorrevisão e estado da entrega

01/11/2026. Revisão pelo próprio autor; não é revisão independente.

## Resultado

Proposta visual e contrato detalhado preparados para revisão. G1 concluído como entrega documental, sem declaração de aprovação humana da proposta, código implementado, API funcional ou testes de produção. A implementação continua por iniciar no âmbito desta melhoria.

## Ajustes feitos na revisão

- Conservadas abertura, descrição e ações privadas na tabela; cinco grupos de dados não eliminam funções existentes.
- Corrigido o rótulo ambíguo para Estado da oportunidade.
- Snapshot de catálogo separado de revisão individual; não há escrita em GET nem renovação implícita da validade.
- Coleções da ficha paginadas, sem transportar documentos integrais nem dados privados de candidaturas.
- Recuperação de expiração não mistura gerações; autoridade atual prevalece sobre tokens antigos.
- Comparação financeira não soma verbas partilhadas; datas sem fuso preservam a incerteza.
- Exemplos mantêm observação/revisão posteriores à publicação documental fictícia; não correspondem a dados reais.
- Corrigidos símbolos de seleção que não eram desenhados corretamente na primeira renderização.

## Validação desta entrega

Verificadas imagens estáticas de desktop, ficha e telemóvel; estrutura JSON, invariantes explícitas de exemplos, TTL, contagem de páginas, identidade lista/ficha e ligações locais da galeria. O relatório JSON regista verificações e hashes. Não é validação por OpenAPI/JSON Schema, teste HTTP, browser funcional ou ensaio de acessibilidade; esses trabalhos pertencem à implementação.

## Limites e decisões

Disposição visual, filtro inicial e parâmetros propostos são concretos e estão documentados, mas não são apresentados como aprovação já dada pelo utilizador. Áreas mantém contrato editorial próprio pendente e AC18 continua no âmbito global. O orçamento de desempenho é alvo para ensaio, não medição ou SLA de produção. Nenhuma importação, migração, reativação EU ou alteração de código foi realizada.

Próximo passo: validar a proposta G1 e preparar G2 com schemas e fixtures de regressão no ambiente isolado, mantendo fontes suspensas.
