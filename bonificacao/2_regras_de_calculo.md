# Regras de cálculo da bonificação

Versão 1.5 de 26/11/2026, aprovada pela gerência. Estas regras estão implementadas no arquivo `claude/7_gerador_relatorio_performance.py` (relatório), a regra 12 no arquivo `claude/8_rotina_conflitos_alertas.py` (rotina diária) e a regra 13 no arquivo `claude/9_gerador_resumo_equipe.py` (fechamento da equipe). Qualquer mudança aprovada deve ser feita nos arquivos ao mesmo tempo e registrada no histórico ao final.

## 1. Período e funcionário
- Mês civil no horário de Brasília: do dia 1 às 00:00 ao último dia às 23:59.
- Funcionário identificado pelo código do crachá (ex.: PL33). No WMS, a ligação é pela coluna wms_tarefas.codigo_func. Tarefas do WMS sem vínculo (codigo_func vazio) não entram para ninguém; a quantidade no período é informada só no resumo da conversa, não no PDF.
- Se o nome pedido corresponder a mais de um funcionário no cadastro, perguntar qual é antes de seguir.

## 2. Tempo de cada tarefa
| Origem | Tarefas consideradas | Tempo |
|---|---|---|
| App Tarefas (registros) | status = finalizada ou timeout | data_fim menos data_inicio |
| WMS (wms_tarefas) | todas | execucao_seg (igual a conclusão menos aceite), com a exceção do Recebimento abaixo |

- Tarefas do app encerradas por timeout ENTRAM no tempo (somar normalmente). O PDF mostra só o total (quantidade e horas somadas); a lista vai no resumo da conversa.
- Tarefas do app em andamento: não entram.
- Recebimento (WMS) com duração mínima de 2 minutos: toda tarefa de Recebimento com execucao_seg menor que 120 segundos conta como 120 segundos (2 minutos). Tarefas de Recebimento com 2 minutos ou mais usam o execucao_seg normal. A regra vale só para o Recebimento e só para o tempo (horas válidas e produtividade). O ajuste é feito pelo gerador e NÃO é exibido nem no PDF nem no resumo da conversa.
- Na checagem de conflito (regra 3) e de sobreposição entre tarefas do WMS, valem sempre os horários reais registrados (dt_aceite e dt_conclusao), sem o ajuste de 2 minutos.
- Tarefas do WMS do mesmo funcionário não se sobrepõem entre si. Se aparecer algum caso, apontar como anomalia no resumo da conversa, sem descartar. Essa checagem é feita só pelo gerador, com as tarefas do funcionário no período. Nunca checar no banco (regra 10).
- Sobreposição entre duas tarefas válidas do próprio app Tarefas (nenhuma das duas em conflito): o trecho sobreposto é contado uma vez só. Os segundos sobrepostos são descontados da tarefa que começou primeiro. O caso é apontado como anomalia "App x App" no resumo da conversa. Se uma das duas estiver em conflito com o WMS, ela já sai inteira pela regra 3 e não há desconto.

## 3. Conflito entre os sistemas
- Há conflito quando uma tarefa do app Tarefas (finalizada ou timeout) e uma tarefa do WMS do MESMO funcionário têm horários que se sobrepõem por MAIS DE 5 MINUTOS: início do app antes da conclusão do WMS, fim do app depois do aceite do WMS, e o trecho em comum maior que 5 minutos. Sobreposições de até 5 minutos são toleradas (diferença de relógio entre os sistemas) e não geram conflito.
- A comparação é feita com uma tarefa do WMS por vez. Várias sobreposições pequenas (cada uma de até 5 minutos) com tarefas diferentes do WMS não geram conflito, mesmo que somadas passem de 5 minutos.
- Em conflito: a tarefa do WMS é preservada. A tarefa do app Tarefas inteira é marcada como "conflito" e NÃO entra no tempo trabalhado nem na produtividade. Isso vale também para tarefas do app encerradas por timeout.
- O PDF mostra só o total de tarefas e horas não contadas por conflito e marca o dia na grade da página 2. A lista (data, horário, tarefa, duração e com qual tarefa do WMS conflitou) vai no resumo da conversa.
- Onde é calculado: só no gerador, com as tarefas do app (consulta Q3) e do WMS (consulta Q4) já baixadas. Não calcular no banco (regra 10). A rotina diária da regra 12 usa uma definição diferente desde 26/11/2026 (soma das sobreposições; ver regra 12), calculada em Python pelo arquivo 8.
- A consulta Q4 traz o WMS do funcionário com margem de 1 dia antes e 1 dia depois do período, para pegar tarefas que atravessam a virada do mês. As tarefas da margem servem só para checar conflito; as horas somadas são só as do período.
- Premissa: nenhuma tarefa do WMS dura 24 horas ou mais. O gerador confere isso nos dados baixados e interrompe o relatório se encontrar algum caso, para a gerência decidir.
- Lógica de referência, equivalente à do gerador. NÃO executar no banco, porque cada linha do app percorre todo o histórico do WMS do funcionário:

```sql
-- REFERÊNCIA APENAS. Não executar.
SELECT r.id_registro,
       (SELECT w.numero FROM wms_tarefas w
         WHERE w.codigo_func = r.codigo_func
           AND w.dt_aceite < r.data_fim AND w.dt_conclusao > r.data_inicio
           AND (julianday(MIN(r.data_fim, w.dt_conclusao)) - julianday(MAX(r.data_inicio, w.dt_aceite))) * 1440 > 5
         LIMIT 1) AS conflito_wms_numero
FROM registros r
WHERE r.codigo_func = :func AND r.status IN ('finalizada', 'timeout')
  AND r.data_inicio >= :ini AND r.data_inicio < :fim
```

## 4. Funções e produtividade
| Função | Origem | Quantidade usada | Unidade | Meta N2 |
|---|---|---|---|---|
| Carregamento | App (registros + cargas) | registros.volumes_proporcionais (parte do funcionário na carga) | volumes/hora (V/h) | ≥ 220 |
| Separação Manual | WMS | soma de qtde_itens | volumes/hora (V/h) | ≥ 220 |
| Separação Empilhadeira | WMS | quantidade de tarefas | pallets/hora (P/h) | ≥ 12 |
| Realocação de estoque | WMS | quantidade de tarefas | pallets/hora (P/h) | ≥ 12 |
| Armazenagem | WMS | quantidade de tarefas | pallets/hora (P/h) | ≥ 20 |
| Recebimento | WMS | quantidade de tarefas | pallets/hora (P/h) | ≥ 24 |

- Produtividade = quantidade ÷ horas válidas daquela função (no dia ou no mês). No Recebimento, as horas válidas já incluem o mínimo de 2 minutos por tarefa (regra 2).
- Volume por hora (Carregamento e Separação Manual): importa o volume movimentado, não o número de tarefas.
- Pallets por hora (Empilhadeira, Realocação, Armazenagem, Recebimento): importa o número de tarefas, porque o esforço por pallet é o mesmo com 25 ou 100 volumes.
- Carregamento sem volumes_proporcionais (vazio): as horas entram, o volume conta como zero, e o caso é apontado como anomalia "Carga sem volume" no resumo da conversa.
- Funções sem meta: Movimentações, Conferência, Limpeza, Avarias, Balança, Chocolate, Inventário cíclico, Armaz. Corte. Contam o tempo para o N1, mas não têm produtividade cobrada no N2. No relatório, mostrar horas e quantidade delas, sem comparar com meta.
- No PDF, toda função com menos de 3h no mês (com ou sem meta) é agrupada em "Outras", porque não conta para o N2. As horas dela continuam somando para o N1.

## 5. Níveis
- N1 Assiduidade: soma das horas válidas do mês (app sem conflitos, com as tarefas encerradas por timeout incluídas, + WMS) ≥ 100h.
- N2 Produtividade: só se tiver N1. Para cada função COM meta em que o funcionário teve 3h ou mais de horas válidas no mês, a produtividade do mês tem que atingir a meta. Funções com menos de 3h não entram.
  - Funcionário com N1 que não teve nenhuma função com meta com 3h ou mais no mês (ex.: só Conferência e Limpeza) GANHA o N2.
- N3 Excelência: só se tiver N1 e N2. Menos de 3 alertas no mês (tabela alertas, pela data do alerta em Brasília, mesmo que o fato descrito seja de outro mês). Contam todos os alertas da tabela, inclusive os gravados pela rotina de conflitos (regra 12, emissor PL1). Alertas contestados e aceitos são removidos da tabela pela gerência.
- Situação de cada nível: "CONQUISTADO", "NÃO CONQUISTADO" ou "BLOQUEADO" (quando o nível anterior não foi conquistado).

## 6. Pontos a cargo da gerência (não estão no banco)
Período de experiência (90 dias), férias, atestados, faltas e falhas de sistema são tratados pela gerência fora desta análise. O relatório não avalia esses pontos. Se a gerência informar um ajuste na conversa, aplicar exatamente como informado.

## 7. Mês incompleto
- Antes de calcular, conferir a quantidade de tarefas do WMS por dia no mês (consulta Q2 do arquivo 6, uma vez por mês; no fechamento da equipe, QE1 do arquivo 9). Se o mês não terminou ou se algum dia útil tem volume muito abaixo do normal, avisar a gerência e perguntar como seguir (cortar no último dia completo, usar tudo o que existe ou esperar). No fechamento da equipe não existe corte parcial (regra 13).
- Relatório parcial: os dois sistemas (app e WMS) são cortados na mesma data. Os alertas também valem só até essa data. O PDF leva no nome do mês a indicação "(parcial: dd a dd/mm)" e uma faixa de aviso no topo da página 1 dizendo que os níveis refletem só o período e não são o resultado final do mês.

## 8. Anomalias (apontadas no resumo da conversa, sem descartar dados; não vão ao PDF)
- "App x App": sobreposição entre tarefas válidas do app (regra 2).
- "WMS x WMS": sobreposição entre tarefas do WMS do mesmo funcionário.
- "Carga sem volume": Carregamento sem volumes_proporcionais (regra 4).
- "Horário divergente": o código do registro (R + AAAAMMDDHHMMSS + crachá) indica um horário de início diferente do data_inicio gravado. A tarefa é somada como gravada. Não supor a causa.

## 9. Ponto em aberto (aguardando decisão da gerência)
- Volumes repetidos no Carregamento: há cargas em que o mesmo funcionário tem dois ou mais registros e cada um traz a parte inteira dele em volumes_proporcionais, de modo que a soma pode passar do total da carga (ex.: carga 8666, out/2026). Até haver decisão, seguir a regra 4 ao pé da letra (somar volumes_proporcionais) e apontar os casos encontrados no resumo da conversa.

## 10. Uso do banco (economia de leituras)
A Turso cobra por linha lida, inclusive as linhas percorridas e descartadas. Para não gastar leituras à toa:
- Nunca juntar `wms_tarefas` ou `registros` com a própria tabela no banco (self-join). Em 24/11/2026, uma consulta assim, sem filtro e rodada 3 vezes, leu 168.139.239 linhas.
- Nunca calcular conflito ou sobreposição no banco. Esses cálculos são feitos só pelo gerador (relatório) e pelo script da rotina diária (regra 12).
- Toda consulta às tabelas `wms_tarefas`, `registros`, `cargas` e `alertas` filtra por funcionário e período, pelas colunas originais com índice, em UTC. Exceções, só com filtro de período: Q2 e Q6 (arquivo 6) e, no fechamento da equipe, QE1 e QE2 (arquivo 9), que substituem a Q2 e a Q6 e leem as mesmas linhas.
- Não usar views nos relatórios e não rodar consultas exploratórias fora dos procedimentos dos arquivos 6, 8 e 9. Uma view comum não guarda resultado: ler por ela lê as mesmas linhas das tabelas (ou mais), por isso não serve para economizar leituras.
- O banco é só leitura. Única exceção: a rotina diária de conflitos (regra 12) pode fazer INSERT em `conflitos` e `alertas` e UPDATE de `conflitos.id_alerta`, seguindo o arquivo 8.

## 11. Comparação com o mês anterior
- O relatório compara o mês apurado com o mês civil anterior completo do mesmo funcionário, calculado pelo gerador com as mesmas regras (2 a 5), a partir das consultas Q3A, Q4A e Q5A do arquivo 6.
- Compara: total de horas válidas, horas de cada função com 3h ou mais em pelo menos um dos dois meses (o resto em "Outras"), produtividade das funções avaliadas no N2 nos dois meses, quantidade de alertas e os níveis do mês anterior.
- Variação: só seta e valor (↑ aumentou, ↓ diminuiu, = igual). O relatório não usa palavras de avaliação como "melhorou" ou "piorou" em nenhum lugar.
- Sem dados do mês anterior (funcionário novo, ou mês anterior sem nenhuma hora válida): o PDF mostra "Sem dados do mês anterior para comparação."
- Não se roda a Q2 para o mês anterior. Se o mês anterior parecer incompleto (por exemplo, um dos sistemas sem nenhuma tarefa no mês ou em boa parte dele), avisar a gerência no resumo da conversa antes de entregar.

## 12. Alerta automático por conflitos (rotina diária)
- O funcionário não deve usar o app Tarefas e o WMS ao mesmo tempo. Os conflitos são gravados na tabela `conflitos` por uma rotina diária às 06:00 (procedimento no arquivo `claude/8_rotina_conflitos_alertas.md`).
- Conflito na rotina diária (desde 26/11/2026): tarefa do app (finalizada ou timeout) em que a SOMA do tempo em comum com todas as tarefas do WMS do mesmo funcionário passa de 5 minutos. Diferente da regra 3, várias sobreposições pequenas somadas geram conflito (ex.: Movimentação 13:00 às 13:45 com três tarefas do WMS de 2 minutos cada no meio = 6 minutos = conflito).
- Uma tarefa do app gera no máximo 1 conflito. Fica registrada a tarefa do WMS de maior sobreposição (empate: aceite mais cedo), e `sobreposicao_seg` guarda a soma.
- Data do conflito: início do primeiro trecho em comum (o maior entre o início da tarefa do app e o aceite da primeira tarefa do WMS que se sobrepõe). Ela define o mês do conflito.
- A cada 3 conflitos do mesmo funcionário no mesmo mês, 1 alerta na tabela `alertas`. Cada conflito entra em um único alerta. A contagem zera ao final do mês e as sobras se perdem.
- O alerta leva: data_alerta = início da sobreposição do 3º conflito; emissor = PL1; descrição "Alerta gerado por 3 conflitos: " seguida dos 3 conflitos (data, horário da tarefa do app, tarefa do app, número e tarefa do WMS, tempo em comum).
- O alerta conta para o N3 como qualquer outro (regra 5).
- Alerta contestado removido pela gerência: nada muda nos conflitos dele, que não voltam para a contagem.
- Cada execução verifica os últimos 5 dias completos e ignora o que já está gravado, para cobrir atrasos na importação do WMS.
- O relatório de performance continua calculando os conflitos pelo gerador (regra 3, uma tarefa do WMS por vez), sem ler a tabela `conflitos`. Por decisão da gerência em 26/11/2026, as duas definições ficam diferentes: uma tarefa do app pode ser conflito na rotina (e contar para alerta) e continuar somando horas no relatório.

## 13. Fechamento da equipe e resumo do RH ("Desempenho da Equipe")
- Pedido "rode o Desempenho da Equipe", "performance da equipe" ou qualquer resultado mensal "da equipe": seguir o procedimento do arquivo `claude/9_fechamento_equipe.md`.
- Só com o mês civil completo. Não existe fechamento parcial da equipe; o gerador 9 para se receber um mês parcial.
- Entram todos os funcionários que computaram ao menos uma tarefa no mês: tarefa do WMS com o crachá, ou tarefa do app finalizada ou timeout. Ativos e inativos (desligados no mês) entram. Quem não teve nenhuma tarefa não tem PDF nem aparece no resumo do RH.
- Crachá com tarefas que não está na tabela `funcionarios`: avisar e esperar a decisão da gerência.
- Retirada pela gerência ("retire o PLx do resumo"): a pessoa some, sem nenhuma menção, do resumo do RH, do PDF de impressão e da conferência. O motivo fica registrado só no `entrada_equipe.json`.
- Níveis e números de cada funcionário: os do relatório individual (gerador 7), sem nenhum recálculo.
- Valores da bonificação, acumulados: N1 R$ 50,00; N2 mais R$ 100,00 (total R$ 150,00); N3 mais R$ 150,00 (total R$ 300,00). Sem N1: R$ 0,00.
- Nível final para a contagem do RH: o nível mais alto conquistado (N3, N2, N1 ou sem bonificação). Cada funcionário conta em um só grupo.
- Motivo no resumo do RH: só o primeiro nível não conquistado (os seguintes ficam bloqueados).
- Mês anterior no resumo do RH: só o nível do funcionário no mês anterior, calculado com as regras atuais (pode diferir do que foi pago, porque não inclui os ajustes da gerência daquele mês nem regras antigas). Sem valor em R$ e sem comparação nos cartões.
- Consultas: QE1 e QE2 no lugar da Q2 e da Q6 (regra 10); Q4 e Q4A um funcionário por vez; as demais consultas do arquivo 6 em uma só consulta com `IN (...)`.

## Histórico de decisões
| Data | Decisão |
|---|---|
| 24/11/2026 | Timeout entra nas horas do N1 (regra 5 corrigida para ficar igual à regra 2). |
| 24/11/2026 | Sobreposição entre tarefas do próprio app contada uma vez só, descontada da tarefa que começou primeiro. |
| 24/11/2026 | Recebimento com menos de 2 minutos conta como 2 minutos (só tempo; conflito usa horários reais). |
| 24/11/2026 | N2 passa a considerar funções com 3h ou mais (antes: mais de 10h). |
| 24/11/2026 | Metas: Armazenagem 24 → 20 pallets/h; Carregamento 200 → 220 volumes/h. |
| 24/11/2026 | Relatório sem bloco de observações; ajustes da gerência não são registrados no PDF. |
| 24/11/2026 | Mês incompleto: relatório parcial cortado no último dia completo do WMS, com aviso no PDF. |
| 24/11/2026 | Economia de leituras (v1.1): conflito e sobreposições calculados só no gerador; consulta do WMS com margem de 1 dia; premissa de nenhuma tarefa do WMS com 24h ou mais, conferida pelo gerador; proibição de self-join e de consultas sem filtro (regra 10). |
| 25/11/2026 | Novo modelo do PDF (v1.2), pedido pela gerência: impressão em preto e branco em 1 folha frente e verso, entregue ao funcionário. Conflitos e timeouts só em totais no PDF (listas no resumo da conversa); anomalias e WMS sem vínculo só no resumo da conversa; ajuste do Recebimento aplicado, mas não exibido no PDF nem no resumo; funções com menos de 3h agrupadas em "Outras"; sem gráfico de horas acumuladas (para não desestimular o esforço no fim do mês). |
| 25/11/2026 | Comparação com o mês anterior no PDF (regra 11). Consultas Q3A, Q4A e Q5A acrescentadas ao procedimento. |
| 25/11/2026 | Retiradas as palavras "melhorou"/"piorou" da comparação, a pedido da gerência: a variação mostra só seta e valor. |
| 25/11/2026 | Regra 12 (v1.3): alerta automático a cada 3 conflitos no mês, gravado por rotina diária às 06:00 (tabela `conflitos`, emissor PL1, data do alerta = início da sobreposição do 3º conflito, contagem zera no fim do mês, janela de 5 dias). Autorizada escrita no banco só para essa rotina. Novembro/2026 processado desde o dia 1. |
| 26/11/2026 | Regra 12 (v1.4), pedido da gerência: na rotina diária, conflito passa a ser a SOMA do tempo em comum com todas as tarefas do WMS (mais de 5 min no total); registra a tarefa do WMS de maior sobreposição; data do conflito = início do primeiro trecho em comum. Vale daqui para frente (execução de 27/11 em diante, janela de 5 dias), sem reprocessar novembro. A regra 3 do relatório de performance NÃO mudou. Arquivo 8 atualizado para a v1.1. |
| 26/11/2026 | Regra 13 (v1.5), pedido da gerência: fechamento mensal "Desempenho da Equipe" (arquivo 9 e gerador 9). Entram todos com tarefas no mês (ativos e inativos); só mês completo; PDF único de impressão em ordem alfabética; resumo do RH colorido por e-mail com cartões por nível, nomes por nível, ✔/✘/– por nível, valor e motivo, e só o nível do mês anterior; arquivo de conferência interno separado; valores N1 R$ 50, N2 +R$ 100, N3 +R$ 150 (acumulados); retirada pela gerência sem menção. Regra 10: QE1 e QE2 como exceções (substituem Q2 e Q6); Q4 e Q4A um funcionário por vez. Gerência avaliou view para reduzir leituras: descartada (view não guarda resultado), assim como tabela de resumo diária (exigiria nova escrita no banco). |
