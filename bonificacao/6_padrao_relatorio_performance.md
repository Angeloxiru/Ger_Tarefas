# Padrão do relatório de performance mensal (procedimento obrigatório)

Versão 1.3 de 26/11/2026. Todo pedido de "performance", "relatório", "documento" ou "PDF" mensal de um funcionário segue este procedimento, sem exceção. Ele garante os mesmos cálculos, a mesma visualização e o mesmo resumo para todos os funcionários, com o menor consumo possível de leituras no banco. Pedidos da equipe inteira ("Desempenho da Equipe", "performance da equipe") seguem o arquivo `claude/9_fechamento_equipe.md`, que usa as consultas e o gerador deste arquivo.

Arquivos do padrão:
- `2_regras_de_calculo.md`: o que calcular.
- `4_modelo_relatorio_pdf.md`: como o PDF fica.
- `claude/7_gerador_relatorio_performance.py`: o código que calcula e gera o PDF (conflitos, sobreposições, ajustes, níveis, comparação com o mês anterior). É a única forma permitida de gerar o relatório. Não reescrever, não ajustar layout à mão, não alterar o código sem pedido da gerência.

## Uso do banco: economia de leituras (obrigatório)
A Turso cobra por linha lida, inclusive as linhas percorridas e descartadas. Em 24/11/2026, uma única consulta sem filtro (`wms_tarefas` juntada com ela mesma), rodada 3 vezes, leu 168.139.239 linhas.
- PROIBIDO juntar `wms_tarefas` com ela mesma, ou `registros` com ela mesma, no banco (self-join), com ou sem filtro. Sobreposições WMS x WMS e App x App são calculadas só pelo gerador.
- PROIBIDO calcular conflito app x WMS no banco (subconsulta por linha do app). O conflito é calculado só pelo gerador, a partir de Q3 e Q4.
- PROIBIDO consultar sem filtro de funcionário e de período as tabelas `wms_tarefas`, `registros`, `cargas` e `alertas`. As únicas exceções são Q2 e Q6, que têm filtro de período (e, no fechamento da equipe, QE1 e QE2 do arquivo 9, que as substituem).
- Não usar as views `vw_wms_tarefas`, `vw_wms_resumo_dia`, `vw_registros` e `vw_exportacao` nos relatórios. Elas calculam colunas em todas as linhas antes de filtrar.
- Filtrar sempre pelas colunas originais com índice (`codigo_func` e `dt_aceite`, `codigo_func` e `data_inicio`, `codigo_func` e `data_alerta`), em UTC, sem funções em volta da coluna filtrada.
- Rodar cada consulta uma vez só por pedido. Não repetir uma consulta para "conferir" e não rodar consultas exploratórias fora deste procedimento. Para mais de um funcionário, usar `codigo_func IN (...)` numa única consulta, exceto Q4 e Q4A, que no fechamento da equipe rodam um funcionário por vez (arquivo 9).
- Q2 roda uma vez por mês consultado, mesmo que o pedido tenha vários funcionários. Não rodar Q2 para o mês anterior.

## Passo 1. Identificar funcionário e período
- Q1 (funcionário): procurar pelo nome em `funcionarios.nome` e `nome_completo` (ou pelo crachá em `codigo`, se o pedido vier com o crachá). Se vier mais de um, perguntar qual (ou se são todos). A tabela é pequena.
```sql
SELECT codigo, nome, nome_completo, cargo, ativo, codigo_wms FROM funcionarios
WHERE nome LIKE '%<nome>%' OR nome_completo LIKE '%<nome>%';
```
- Limites do período em UTC: :ini = 'AAAA-MM-01T03:00:00Z' e :fim = primeiro dia do mês seguinte às 'T03:00:00Z'.
- Limites com margem, só para Q4: :ini_m = :ini menos 1 dia e :fim_m = :fim mais 1 dia (ex.: outubro → '2026-09-30T03:00:00Z' a '2026-11-02T03:00:00Z').
- Limites do mês anterior (completo), para Q3A, Q4A e Q5A: :ini_a = primeiro dia do mês anterior às 'T03:00:00Z' e :fim_a = :ini; com margem para Q4A: :ini_am = :ini_a menos 1 dia e :fim_am = :ini mais 1 dia (ex.: relatório de novembro → mês anterior outubro: '2026-10-01T03:00:00Z' a '2026-11-01T03:00:00Z'; Q4A de '2026-09-30T03:00:00Z' a '2026-11-02T03:00:00Z').

## Passo 2. Conferir se há dados do mês inteiro (uma vez por mês)
Q2 (cobertura): tarefas do WMS por dia e último registro do app.
```sql
SELECT date(dt_aceite,'-3 hours') dia, COUNT(*) n, MAX(time(dt_aceite,'-3 hours')) ultima
FROM wms_tarefas WHERE dt_aceite >= :ini AND dt_aceite < :fim GROUP BY 1 ORDER BY 1;
SELECT MAX(data_inicio) FROM registros WHERE data_inicio >= :ini AND data_inicio < :fim;
```
- Se o mês não terminou ou algum dia útil estiver claramente incompleto, avisar com os números e perguntar: cortar no último dia completo (relatório parcial), usar tudo, ou esperar. Seguir a regra 7 das Regras de cálculo.
- A tabela `wms_importacoes` NÃO serve para conferir cobertura: o período informado por arquivo não garante que todos os dias estejam completos.

## Passo 3. Extrair os dados (sempre estas consultas, com estes nomes de coluna)
Q3 (app Tarefas, sem cálculo de conflito):
```sql
SELECT r.id_registro, r.nome_tarefa, r.status,
       datetime(r.data_inicio,'-3 hours') ini, datetime(r.data_fim,'-3 hours') fim,
       CAST(ROUND((julianday(r.data_fim)-julianday(r.data_inicio))*86400,0) AS INTEGER) seg,
       r.volumes_proporcionais vol
FROM registros r
WHERE r.codigo_func = :func AND r.status IN ('finalizada','timeout')
  AND r.data_inicio >= :ini AND r.data_inicio < :fim
ORDER BY r.data_inicio;
```
Q4 (WMS com margem de 1 dia antes e depois, horários reais e execucao_seg original; o gerador usa a margem só para checar conflito e soma apenas as tarefas do período):
```sql
SELECT numero, tarefa, datetime(dt_aceite,'-3 hours') ini, datetime(dt_conclusao,'-3 hours') fim,
       execucao_seg, qtde_itens
FROM wms_tarefas WHERE codigo_func = :func AND dt_aceite >= :ini_m AND dt_aceite < :fim_m
ORDER BY dt_aceite;
```
Q5 (alertas):
```sql
SELECT id_alerta, datetime(data_alerta,'-3 hours') data_br, descricao, emissor
FROM alertas WHERE codigo_func = :func AND data_alerta >= :ini AND data_alerta < :fim
ORDER BY data_alerta;
```
Q6 (WMS sem vínculo no período; só para o resumo da conversa; duas contagens separadas para usar o índice, somar as duas):
```sql
SELECT (SELECT COUNT(*) FROM wms_tarefas WHERE codigo_func IS NULL AND dt_aceite >= :ini AND dt_aceite < :fim)
     + (SELECT COUNT(*) FROM wms_tarefas WHERE codigo_func = ''   AND dt_aceite >= :ini AND dt_aceite < :fim) AS sem_vinculo;
```
Q3A, Q4A e Q5A (mês anterior, para a comparação): as mesmas consultas Q3, Q4 e Q5, com os mesmos nomes de coluna, trocando os limites por :ini_a e :fim_a (Q3A e Q5A) e por :ini_am e :fim_am (Q4A). O mês anterior é sempre o mês civil completo, mesmo quando o relatório atual é parcial.
- No relatório parcial, :fim (e :fim_m) seguem a data de corte (ex.: corte em 19/11 → :fim = '2026-11-20T03:00:00Z' e :fim_m = '2026-11-21T03:00:00Z').
- Salvar o resultado de cada consulta como JSON, exatamente como o conector retorna (`columns` e `rows`), sem copiar valores à mão. Quando o resultado é grande, o conector já o salva em arquivo. Para forçar isso em resultados pequenos, pode-se acrescentar à consulta a coluna `printf('%3000s','') AS pad`, que o gerador ignora. Esse preenchimento não aumenta as linhas lidas, mas NÃO deve ser usado na Q4/Q4A: com milhares de linhas, o resultado fica grande demais e a conexão com o conector cai.

## Passo 4. Gerar o PDF
1. Copiar `claude/7_gerador_relatorio_performance.py` do projeto para a área de trabalho, sem alterações.
2. Montar o `entrada.json` com: cracha, nome (nome_completo), mes_txt ("Novembro/2026" ou "Novembro/2026 (parcial: 01 a 24/11)"), aaaamm, periodo_txt, parcial (texto da faixa de aviso, ou vazio), periodo_ini e periodo_fim (datas de Brasília, fim exclusivo, ex.: "2026-11-01" e "2026-12-01"), gerado (data de hoje), wms_sem_vinculo (Q6), app (Q3), wms (Q4), alertas (Q5) e anterior (mes_txt, periodo_ini, periodo_fim, app de Q3A, wms de Q4A, alertas de Q5A). Se Q3A e Q4A não trouxerem nenhuma linha, passar o bloco anterior com as linhas vazias: o PDF mostra "Sem dados do mês anterior para comparação." O formato está no cabeçalho do gerador.
3. Rodar: `python3 7_gerador_relatorio_performance.py entrada.json pasta_saida`. O gerador imprime um resumo em JSON com os números, as listas de conflitos, timeouts e anomalias, o WMS sem vínculo e o resumo do mês anterior.
4. Se o gerador parar com "PARADO: há tarefa do WMS com 24h ou mais", não contornar: avisar a gerência com os números das tarefas e aguardar decisão.
5. Abrir o PDF gerado e conferir visualmente as 2 páginas, de preferência em tons de cinza (o relatório é impresso em preto e branco).

## Passo 5. Conferências antes de entregar
- Volumes repetidos no Carregamento (regra 9): cruzar `cargas` com `registros` e listar, no resumo da conversa, as cargas em que o funcionário tem mais de um registro com volumes_proporcionais repetidos, ou em que a soma passa do total da carga. Só é preciso rodar se o funcionário tiver Carregamento no período (ver o resumo do gerador ou Q3).
```sql
SELECT r.id_registro, datetime(r.data_inicio,'-3 hours') ini, r.volumes_proporcionais vp,
       c.numero_carga, c.qtd_volumes
FROM registros r LEFT JOIN cargas c ON c.id_registro = r.id_registro
WHERE r.codigo_func = :func AND r.nome_tarefa = 'Carregamento' AND r.status IN ('finalizada','timeout')
  AND r.data_inicio >= :ini AND r.data_inicio < :fim ORDER BY r.data_inicio;
```
- Mês anterior (regra 11): se Q3A ou Q4A vierem sem nenhuma linha em boa parte do mês, ou se um dos sistemas não tiver nenhuma tarefa no mês anterior, avisar a gerência no resumo, porque a comparação pode estar distorcida.
- Casos que as regras não cobrem: descrever e perguntar antes de entregar. Não decidir sozinho.

## Passo 6. Resposta na conversa (sempre neste formato)
1. Uma frase com o resultado: níveis conquistados e o número que decide (ex.: horas válidas x 100h).
2. Números principais: horas válidas (App + WMS), horas excluídas por conflito, produtividade de cada função avaliada no N2 contra a meta, quantidade de alertas, e o resumo da comparação com o mês anterior. NÃO mencionar o ajuste do Recebimento (mínimo de 2 minutos).
3. Conflitos (lista), timeouts (lista), anomalias e tarefas do WMS sem vínculo no período, em poucas linhas. Esses itens não estão no PDF.
4. Pontos para a gerência conferir ou decidir (dados estranhos, regra 9, mês anterior incompleto, casos não cobertos). Nunca supor causas; apresentar só os fatos.
5. Consultas SQL principais usadas (Q3, Q4, Q5, Q3A, Q4A, Q5A e as extras).
6. Entregar o PDF.

## Vários funcionários no mesmo pedido
- Equipe inteira do mês ("Desempenho da Equipe", "performance da equipe"): seguir o arquivo `claude/9_fechamento_equipe.md` (regra 13).
- Alguns funcionários escolhidos: rodar Q3, Q5, Q3A, Q5A e a consulta de cargas uma vez para todos (`codigo_func IN (...)`, incluindo `codigo_func` nas colunas), Q4 e Q4A um funcionário por vez, e separar por funcionário ao montar cada `entrada.json`. Um PDF por funcionário e uma tabela comparativa na resposta: horas válidas, App + WMS, conflitos, alertas e N1/N2/N3. Nunca misturar dados de um funcionário no relatório de outro.

## Histórico
| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 24/11/2026 | Procedimento criado. |
| 1.1 | 24/11/2026 | Economia de leituras: conflito e sobreposições calculados só no gerador; Q3 sem subconsulta; Q4 com margem de 1 dia; Q6 com índice; proibição de self-join, de consultas sem filtro e das views nos relatórios. |
| 1.2 | 25/11/2026 | Novo modelo do PDF (1 folha frente e verso, preto e branco). Consultas Q3A, Q4A e Q5A do mês anterior para a comparação. Resumo da conversa passa a trazer as listas de conflitos e timeouts, anomalias e WMS sem vínculo (que saíram do PDF) e deixa de citar o ajuste do Recebimento. Aviso sobre não usar o preenchimento `pad` na Q4. |
| 1.3 | 26/11/2026 | Pedidos da equipe inteira passam a seguir o arquivo 9 (Desempenho da Equipe). Q4 e Q4A com vários funcionários: um funcionário por vez. QE1 e QE2 citadas como exceções de filtro no fechamento da equipe. |
