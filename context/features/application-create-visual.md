# Nova candidatura — apresentação

State: Review

## Âmbito e direção visual

Pedido de 03/11/2026: aplicar ao formulário existente o padrão visual da ficha. Apenas criação em GCNI_C4G, sem novos campos ou funcionalidades de negócio, sem alterar o modal de edição.

Cabeçalho petróleo #075b59 com organização e estado inicial Identificada; superfície branca #fff; cabeçalhos de secção #dcebe6; contornos #84968f; texto #173b41; ação principal verde #39751f. Tipografia existente, títulos sem maiúsculas forçadas, alinhamento à esquerda e foco visível. Reutilizar o formulário e os seus controlos; evitar duplicar título/contexto e instruções já expressas nos campos.

Layout: cabeçalho → contexto oportunidade/análise → formulário em duas áreas **Dados da candidatura** e **Orçamento e notas** → Cancelar / Criar candidatura. Duas colunas em desktop; sequência única em mobile. Avisos de origem, erros e pendentes sempre visíveis.

## Critérios de aceitação

- Manter título, responsável/paginação, prazo interno, unidades, orçamento total, orçamento da organização, notas, referência de avaliação privada e checkbox de equipa condicionado à permissão. Mesmos labels, limites e payloads.
- Manter título/prazo/fonte oficial da oportunidade, cópia explícita das notas sem sobrescrever e consulta do interesse de origem.
- Preservar seleção de unidades, avisos de indisponibilidade, revisões atuais, permissões, pendentes, repetição explícita e retorno filtrado. Abrir/cancelar nunca cria; apenas confirmação envia.
- Agrupamento visual opcional em ApplicationFields apenas na criação; edição da ficha mantém a apresentação e comportamento existentes.
- Contraste, rótulos/foco, controlos com dimensões legíveis e ausência de overflow em desktop/tablet/mobile; todos os campos continuam no mesmo formulário.

## Validação

Testes existentes de criação e edição; regressão focada de agrupamento/associação ao formulário. Chrome com API simulada para origens central/com interesse/privada, campos condicionais, valores zero/decimais, cancelamento e confirmação. Suite local frontend, regressão backend exigida pelo repositório e build. Sem dados reais, alterações backend, migrations ou envios.

## Resultado

Integrado na GCNI_C4G. Cabeçalho com organização e estado inicial; contexto da oportunidade e análise separado dos campos; agrupamento **Dados da candidatura / Orçamento e notas**; labels legíveis, contornos e ações com contraste, orçamentos alinhados, botões de recuperação coerentes. Layout em colunas adapta-se a sequência única no telemóvel. Retiradas instruções que repetiam campos/navegação; textos de erro, permissões e revisões continuam visíveis.

ApplicationFields reutiliza os mesmos controlos em ambos os ramos; agrupamento só na criação. Campos, condicionais de equipa/avaliação, valores zero/decimais, limites, cópia explícita de notas, Fonte oficial e retorno preservados. Sem alterações backend, de negócio ou ao layout de edição.

Validação: regressão de associação dos campos ao único formulário e payload privado primeiro falhou; 92 testes focados PASS; frontend 768 PASS (87 ficheiros); backend 2652 PASS/7 SKIP/0 FAIL; build final PASS. Logs `output/application-create-{red,focused,frontend,backend,build}.log`. Avisos preexistentes de jsdom/React sem falhas. Revisão independente sem achados funcionais.

Chrome com API simulada: 9 cenários em 1440/1024/390 px, cobrindo origem central com/sem interesse, privada com avaliação, origem sem permissão e envio pendente. Verificados alinhamento/contraste, associação e ordem dos campos por teclado, valores exatos, campos condicionais, copiar notas, cancelar sem criar, confirmação única, recuperação explícita e retorno filtrado; sem overflow ou erros de página. Gate `test/integration/local-platform/application-create-visual-ui.cjs`; evidências/capturas verificadas em `output/playwright/application-create/`. Sem login ou dados reais.

Próximo passo: aplicar o mesmo padrão visual à lista de interesses, preservando o acesso direto às candidaturas.
