# Modelo do relatório PDF de performance

Versão 1.3 de 27/11/2026, aprovada pela gerência. Este modelo é produzido pelo arquivo `claude/7_gerador_relatorio_performance.py`. O PDF deve SEMPRE ser gerado por esse código, sem montar o layout à mão e sem alterar o código. Assim, todos os funcionários recebem o mesmo cálculo e a mesma visualização.

## Princípios
- O relatório é entregue impresso ao funcionário, em preto e branco. Nada depende de cor: a diferença entre situações é feita por preenchimento preto, borda grossa, borda tracejada, símbolos (✔ ✘ – ↑ ↓) e palavras.
- Uma folha, frente e verso (2 páginas). Página 1 com o resultado e a comparação; página 2 com o detalhe por dia e a produtividade diária.
- Só entra o que o funcionário precisa para entender o próprio resultado. Anomalias, tarefas do WMS sem vínculo, a lista de conflitos e de timeouts e o ajuste do Recebimento (mínimo de 2 minutos) NÃO aparecem no PDF. Anomalias, WMS sem vínculo e as listas de conflitos e timeouts vão só no resumo da conversa (passo 6 do arquivo 6). O ajuste do Recebimento é aplicado no cálculo, mas não aparece nem no PDF nem no resumo.

## Formato geral
- Um PDF por funcionário e mês. A4 retrato, margens de 1,2 cm. Fonte DejaVu Sans.
- Nome do arquivo: `performance_<CRACHA>_<AAAA-MM>.pdf` (ex.: performance_PL16_2026-11.pdf). O relatório parcial usa o mesmo nome.
- Rodapé em todas as páginas: "Relatório de performance | Nome (crachá) | Mês" à esquerda e "Página N de M" à direita (M é o total real de páginas).
- Se a página 1 não couber numa folha (por exemplo, muitos alertas com descrição longa), o restante continua no verso e a grade da página 2 vem logo em seguida, sem deixar espaço em branco. Nesse caso o relatório pode passar de 2 páginas.
- Cabeçalho das tabelas em fundo preto com texto branco; linhas separadas por fios cinza.
- Horários em Brasília. Tempo em horas e minutos (12h35). Números no formato brasileiro (1.234,5). Produtividade com 1 casa decimal.
- Unidades de produtividade e meta: "V/h" (volumes por hora) e "P/h" (pallets por hora). Na coluna "Produzido": "pallets", "volumes" ou "tarefas".
- Sem títulos de seção acima das caixas de níveis e da tabela de funções.

## Agrupamento "Outras"
Toda função com menos de 3h no mês (com ou sem meta) não conta para o N2 e é agrupada numa linha "Outras (função, função...)", com os nomes entre parênteses em letra menor, com a soma das horas e das tarefas, produtividade "-", meta "sem meta" e "não conta para o N2". O mesmo agrupamento vale para a coluna "Outras" da grade da página 2.

## Página 1 (frente)
1. Cabeçalho: à esquerda "Relatório de performance mensal" (negrito, 12,75 pt) e, abaixo, nome completo em negrito | Crachá. À direita, o mês e ano (negrito, 12,75 pt) e, abaixo, "Gerado em dd/mm/aaaa". No relatório parcial, o "(parcial: dd a dd/mm)" fica na linha de baixo, antes do "Gerado em". Linha preta grossa abaixo do cabeçalho.
2. Só no relatório parcial: faixa com borda tracejada e o texto "⚠ APURAÇÃO PARCIAL: período de dd/mm/aaaa a dd/mm/aaaa. Os níveis refletem só esse período e podem mudar até o fim do mês."
3. Três caixas lado a lado, N1 Assiduidade, N2 Produtividade, N3 Excelência, cada uma com o símbolo e a situação em letras grandes e o número que decidiu:
   - CONQUISTADO: caixa preenchida de preto, texto branco, "✔ CONQUISTADO".
   - NÃO CONQUISTADO: caixa branca com borda preta grossa, "✘ NÃO CONQUISTADO".
   - BLOQUEADO: caixa com borda cinza tracejada, texto cinza, "– BLOQUEADO".
   - Texto do N1: "XXhXX de 100h00 exigidas".
   - Texto do N2: "N de N funções na meta"; se alguma ficou abaixo: "Abaixo da meta: Função (produtividade de meta unidade)"; sem função avaliável: "Nenhuma função com meta com 3h ou mais"; sem N1: "Depende do N1".
   - Texto do N3: "N alertas no mês (limite: menos de 3)"; se bloqueado, acrescenta ". Depende do N1 e do N2".
   - Abaixo das caixas, em cinza: "Cada nível só pode ser conquistado se o nível anterior também for."
4. Tabela de funções: Função | Horas | Produzido | Produtividade | Meta | Resultado contra a meta. Ordenada da função com mais horas para a com menos, com "Outras" no fim e a linha "Total de horas válidas".
   - Função com meta e 3h ou mais: barra horizontal com escala até 150% da meta e um traço vertical na meta (100%); preenchimento cinza escuro se atingiu, cinza claro se não; ao lado, "✔ 111%" ou "✘ 87%".
   - Função sem meta com 3h ou mais: Produtividade "-", Meta "sem meta", Resultado "não conta para o N2".
   - Trocas de bateria: linha "Troca de bateria" (função sem meta), com "N trocas" na coluna Produzido e a mesma regra do "Outras" (menos de 3h vai para "Outras"). Na grade da página 2, coluna "Troca de bateria" com as horas creditadas no dia.
5. "Comparação com o mês anterior (Mês/AAAA)": Função | Horas (mês anterior) | Horas (mês atual) | Variação das horas | Produtiv. (mês anterior) | Produtiv. (mês atual) | Variação da produtividade.
   - Primeira linha: Total de horas válidas. Depois, uma linha para cada função que teve 3h ou mais em pelo menos um dos dois meses; o resto vai para "Outras". Última linha: Alertas.
   - Variação só com seta e valor, sem palavras de avaliação: horas "↑ +12h05", "↓ -3h56" ou "="; produtividade "↑ +23%", "↓ -2%" ou "="; alertas "↑ +2", "↓ -1" ou "=". "-" quando a função não foi avaliada no N2 em um dos meses. As palavras "melhorou" e "piorou" não aparecem em nenhum lugar do relatório.
   - Abaixo, em cinza: os níveis do mês anterior ("Níveis em Outubro/2026: N1 ✔ N2 ✔ N3 ✔"), a legenda "↑ aumentou, ↓ diminuiu, = igual ao mês anterior" e, no relatório parcial, "Mês atual parcial: as horas ainda não estão completas, compare principalmente a produtividade."
   - Sem dados do mês anterior (funcionário novo ou mês anterior sem nenhuma hora válida): o bloco mostra só a frase "Sem dados do mês anterior para comparação."
6. "Como as horas foram contadas", três linhas só com totais:
   - Horas válidas no mês: XXhXX (App Tarefas XXhXX + WMS XXhXX). Com trocas de bateria no mês, acrescenta " + Trocas de bateria XXhXX (N trocas)".
   - Tarefas do app não contadas por conflito com o WMS: quantidade e horas, com "Quando o app e o WMS registram o mesmo horário, vale o WMS." Sem casos: "Nenhuma".
   - Tarefas encerradas automaticamente (timeout) e somadas: quantidade e horas somadas. Sem casos: "Nenhuma".
7. "Alertas do mês (N)": Data | Descrição | Emissor (crachá), em letra 7 pt para caber na folha. A descrição é impressa como está gravada no banco (quebras de linha viram "; "). Sem casos: "Nenhum alerta no mês."

## Página 2 (verso)
1. "Horas por dia e função": grade com um dia trabalhado por linha ("dd/mm" + dia da semana abreviado) e uma coluna por função (mais horas à esquerda, "Outras" no fim), com as horas válidas de cada função no dia, "Total do dia" em negrito e a linha "Total" do mês.
   - Linha mais grossa antes de cada segunda-feira (nova semana). Dias sem trabalho registrado não aparecem.
   - Dia com tarefa do app excluída por conflito: data com "*" e nota abaixo da grade com o dia, a quantidade de tarefas e as horas não contadas.
2. "Produtividade diária contra a meta (funções que contam para o N2)": um gráfico de barras pequeno para cada função com meta e 3h ou mais no mês, em até 3 colunas. Título de cada gráfico: "Função: produtividade do mês unidade no mês (meta N unidade)". Barra por dia com 30 minutos ou mais na função; barra preta quando o dia ficou abaixo da meta, cinza quando ficou na meta ou acima; meta em linha tracejada. Nota abaixo explicando as cores.
   - Sem função com meta e 3h ou mais: o bloco não aparece.

O relatório termina na página 2, sem bloco de observações.

## Histórico
| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 24/11/2026 | Modelo criado (5 ou mais páginas, colorido). |
| 1.3 | 27/11/2026 | Trocas de bateria (regra 2): linha "Troca de bateria" na tabela de funções (sem meta, "N trocas"), coluna na grade por dia e parcela "Trocas de bateria" na linha de horas válidas. Sem trocas no mês, o PDF fica igual ao da versão 1.2. |
| 1.2 | 25/11/2026 | Novo layout para impressão em preto e branco em 1 folha frente e verso; caixas de níveis com ✔/✘; barra contra a meta; agrupamento "Outras" (< 3h); comparação com o mês anterior (só setas e valores); conflitos e timeouts só em totais; anomalias, WMS sem vínculo e ajuste do Recebimento fora do PDF; grade de horas por dia e função; produtividade diária em gráficos por função; sem gráfico de horas acumuladas. |
