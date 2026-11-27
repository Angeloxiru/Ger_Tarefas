# Desempenho da Equipe: fechamento mensal (procedimento obrigatório)

Versão 1.1 de 27/11/2026, aprovada pela gerência. Vale sempre que a gerência pedir "rode o Desempenho da Equipe", "performance da equipe" ou qualquer resultado mensal "da equipe". Para um funcionário só, vale o arquivo 6.

Entregas (3 arquivos):
- `impressao_equipe_<AAAA-MM>.pdf`: os relatórios individuais de todos, num PDF só, em ordem alfabética, cada funcionário começando numa folha nova (frente e verso). É impresso e entregue aos funcionários.
- `resumo_rh_<AAAA-MM>.pdf`: resumo colorido enviado por e-mail ao RH.
- `conferencia_equipe_<AAAA-MM>.pdf`: uso interno da gerência (conflitos, timeouts, anomalias, WMS sem vínculo, pontos da regra 9). Não vai ao RH nem aos funcionários.

Arquivos do padrão:
- `2_regras_de_calculo.md` (regra 13: quem entra, valores, mês completo, retirada do resumo).
- `claude/6_padrao_relatorio_performance.md`: consultas Q3 a Q7A e montagem do `entrada.json` de cada funcionário.
- `claude/7_gerador_relatorio_performance.py`: gera cada relatório individual. Copiar sem alterações.
- `claude/9_gerador_resumo_equipe.py`: gera o resumo do RH, o PDF de impressão e a conferência a partir do resumo JSON que o gerador 7 imprime. Copiar sem alterações. Não recalcula nada.

Todas as regras de economia de leituras do arquivo 6 e da regra 10 continuam valendo.

## Passo 1. Período (só mês completo)
- O fechamento da equipe só é feito com o mês civil completo. Se o mês pedido ainda não terminou, avisar e não rodar.
- Limites em UTC iguais aos do arquivo 6: :ini, :fim, :ini_m, :fim_m (margem da Q4) e os do mês anterior :ini_a, :fim_a, :ini_am, :fim_am.

## Passo 2. Quem trabalhou no mês e cobertura (QE1 e QE2, uma vez por mês)
QE1 e QE2 substituem a Q2 e a Q6 no fechamento da equipe. Leem as mesmas linhas que a Q2 já leria. São as únicas consultas sem filtro de funcionário permitidas aqui (exceção da regra 10).
```sql
-- QE1: WMS por dia e por funcionário (cobertura do mês, quem trabalhou no WMS, WMS sem vínculo)
SELECT date(dt_aceite,'-3 hours') dia, codigo_func, COUNT(*) n, MAX(time(dt_aceite,'-3 hours')) ultima
FROM wms_tarefas WHERE dt_aceite >= :ini AND dt_aceite < :fim GROUP BY 1,2 ORDER BY 1,2;
-- QE2: app Tarefas por funcionário (só finalizada ou timeout)
SELECT codigo_func, COUNT(*) n, MAX(data_inicio) ultima FROM registros
WHERE data_inicio >= :ini AND data_inicio < :fim AND status IN ('finalizada','timeout') GROUP BY codigo_func;
```
- Cobertura: somar `n` da QE1 por dia. Se algum dia útil estiver claramente incompleto, ou o app parar antes do fim do mês, avisar com os números e perguntar se usa tudo ou espera (não existe fechamento parcial da equipe).
- WMS sem vínculo: soma de `n` das linhas com `codigo_func` vazio ou nulo. Vai para a conferência e para a conversa.
- Funcionários do mês: todos os `codigo_func` não vazios da QE1 e da QE2 (quem computou ao menos uma tarefa do WMS ou do app finalizada ou timeout). Ativos e inativos entram. Quem não aparece nem na QE1 nem na QE2 não tem relatório nem resumo.

QE3 (nomes; tabela pequena):
```sql
SELECT codigo, nome, nome_completo, cargo, ativo FROM funcionarios WHERE codigo IN (...);
```
- Crachá com tarefas que não está em `funcionarios`: avisar e esperar a decisão da gerência antes de seguir.

## Passo 3. Confirmar a lista com a gerência
Mostrar uma tabela curta: crachá, nome completo, cargo, ativo, tarefas no app, tarefas no WMS. Perguntar se há alguém para retirar ("retire o PLx do resumo"). Quem for retirado não tem consultas Q3 a Q7A, não gera PDF e some, sem nenhuma menção, do resumo do RH, da impressão e da conferência. Registrar no `fora_do_rh` do `entrada_equipe.json`.

## Passo 4. Extrair os dados
- Q3, Q5, Q7, Q3A, Q5A e Q7A do arquivo 6: uma consulta para todos, com `codigo_func IN (...)` e `codigo_func` incluído nas colunas. Se o conector não aguentar o tamanho do resultado, dividir em grupos menores, sem repetir os já baixados.
- Q4 e Q4A do arquivo 6: UM FUNCIONÁRIO POR VEZ (decisão da gerência de 26/11/2026). Sem a coluna `pad`.
- Consulta de cargas do passo 5 do arquivo 6 (regra 9): uma vez, com `IN (...)`, só para quem teve Carregamento no mês.
- Q2 e Q6 não são rodadas (QE1 e QE2 já trazem essas informações).
- Salvar cada resultado como JSON, como o conector devolve, e separar por funcionário ao montar cada `entrada.json`. Nunca misturar dados de um funcionário com os de outro.

## Passo 5. Relatórios individuais (gerador 7)
- Para cada funcionário, montar o `entrada.json` como no passo 4 do arquivo 6, com `wms_sem_vinculo` = 0 (o total vai só na conferência da equipe) e rodar `python3 7_gerador_relatorio_performance.py entrada.json pasta_saida`.
- Salvar o resumo JSON impresso pelo gerador 7 de cada funcionário (ele traz o caminho do PDF em `arquivo`).
- Se o gerador 7 parar com "PARADO: há tarefa do WMS com 24h ou mais", não contornar: avisar a gerência e aguardar.

## Passo 6. Resumo do RH, impressão e conferência (gerador 9)
Montar o `entrada_equipe.json` (formato no cabeçalho do gerador 9):
- mes_txt, aaaamm, gerado, mes_anterior_txt, wms_sem_vinculo (da QE1);
- funcionarios: cracha, nome (nome_completo), resumo (JSON do gerador 7) e, se houver, extras (textos para a conferência: volumes repetidos da regra 9, mês anterior incompleto);
- avisos: textos gerais para a conferência (ex.: cobertura);
- fora_do_rh: retirados pela gerência, com o motivo (fica só no JSON).

Rodar: `python3 9_gerador_resumo_equipe.py entrada_equipe.json pasta_saida`.

Retirada pedida depois da geração: acrescentar o crachá em `fora_do_rh` e rodar só o gerador 9 de novo. Não repetir consultas.

## Passo 7. Conferir antes de entregar
- Abrir o `resumo_rh` e conferir visualmente.
- Conferir que a impressão tem os funcionários em ordem alfabética e número par de páginas para cada um.
- Mês anterior (regra 11): se algum funcionário tiver mês anterior com um dos sistemas vazio em boa parte do mês, registrar em `extras` e avisar.

## Passo 8. Resposta na conversa (sempre neste formato)
1. Uma frase: quantos em cada nível (N3, N2, N1, sem bonificação) e o total da bonificação.
2. Tabela por funcionário em ordem alfabética: nome, horas válidas, N1/N2/N3, valor, motivo do primeiro nível não conquistado.
3. Pontos para a gerência conferir ou decidir (cobertura, WMS sem vínculo, regra 9, mês anterior incompleto, casos não cobertos), só fatos. Os detalhes por funcionário ficam no arquivo de conferência.
4. Consultas SQL usadas (QE1, QE2, QE3, Q3, Q5, Q7, Q3A, Q5A, Q7A, Q4 e Q4A por funcionário, cargas).
5. Entregar os 3 arquivos (impressão, resumo do RH, conferência).

## Resumo do RH (layout, gerado pelo gerador 9)
- A4 retrato, colorido, fonte DejaVu Sans.
- Cabeçalho: "Programa de Bonificação por Níveis", "Resumo do resultado da equipe de Logística", mês e "Gerado em".
- Quatro cartões coloridos (N3 Excelência verde, N2 Produtividade azul, N1 Assiduidade amarelo, Sem bonificação cinza): quantidade de funcionários, valor por pessoa e total do nível. Sem dados do mês anterior nos cartões.
- Linha com o número de funcionários avaliados e o total da bonificação.
- "Funcionários por nível": nomes de cada nível ("Ninguém" quando vazio).
- "Resultado por funcionário (ordem alfabética)": Nome | N1 | N2 | N3 (✔ conquistado verde, ✘ não conquistado vermelho, – bloqueado cinza) | Bonificação | Motivo (só o primeiro nível não conquistado; "Todos os níveis conquistados") | Nível no mês anterior (só o nível, sem valor; "sem dados" se não teve horas). Linha de total da bonificação.
- Motivos: "N1: XXhXX de 100h00 exigidas"; "N2: abaixo da meta em Função (produtividade de meta unidade)"; "N3: N alertas no mês (limite: menos de 3)".
- Notas: valores dos níveis, legenda dos símbolos e que o nível do mês anterior é calculado com as regras atuais.

## Histórico
| Versão | Data | Mudança |
|---|---|---|
| 1.1 | 27/11/2026 | Trocas de bateria (regra 2 v1.6): Q7 e Q7A do arquivo 6 com `IN (...)` para todos; a conferência mostra as horas das trocas junto com App e WMS (gerador 9 v1.1). Quem entra no fechamento continua sendo definido por QE1 e QE2 (tarefas do WMS ou do app). |
| 1.0 | 26/11/2026 | Procedimento criado: lista por QE1/QE2, Q4 e Q4A por funcionário, gerador 9 (resumo do RH, impressão única, conferência), valores N1 R$ 50, N2 +R$ 100, N3 +R$ 150, só mês completo, retirada sem menção. |
