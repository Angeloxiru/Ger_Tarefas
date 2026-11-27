# Dicionário de dados (banco Turso do app Tarefas)

Todas as datas estão em UTC (texto ISO terminado em Z). Horário de Brasília = UTC menos 3 horas.
No SQL: datetime(coluna, '-3 hours'). Dia 23/11 de Brasília = de '2026-11-23T03:00:00Z' até antes de '2026-11-24T03:00:00Z'.

## funcionarios
codigo (crachá, ex.: PL33), nome (curto), nome_completo, cargo, ativo (1/0), perfil (funcionario, gestor, adm), codigo_wms (código no WMS, ex.: 33).

## registros (tarefas do app Tarefas)
id_registro, codigo_func, id_tarefa, nome_tarefa (Carregamento, Movimentações, Conferência, Limpeza, Avarias, Balança, Chocolate), data_inicio, data_fim, status (em_andamento, finalizada, timeout), finalizado_por (funcionario ou sistema), volumes_proporcionais (só Carregamento: parte do funcionário nos volumes da carga).

## cargas (leitura do QR de carga, ligada ao registro de Carregamento)
id_registro, codigo_func, numero_carga, qtd_volumes (total da carga), doca, data_leitura, ajudante (1 = carga com ajudante).
Quando mais de uma pessoa trabalha na mesma carga, os volumes são divididos proporcionalmente ao tempo de cada um e gravados em registros.volumes_proporcionais.

## wms_tarefas (tarefas importadas do WMS)
numero (chave), endereco_inicial e partes (deposito, predio, rua, posicao, andar), dt_aceite (início), dt_conclusao (fim), execucao_seg (duração em segundos), cod_aplicacao, tarefa (Separação Manual, Separação Empilhadeira, Armazenagem, Recebimento, Realocação de estoque, Inventário cíclico, Armaz. Corte), cod_func_wms, nome_func_wms, codigo_func (nosso crachá; vazio = sem vínculo), qtde_itens (volumes), qt_enderecos.
Separação Manual = separação por paletes no depósito 1, prédio 2, ruas A, B, C, D ou F, andar 01A. As demais separações por paletes = Separação Empilhadeira.

## alertas
id_alerta (A + AAAAMMDDHHMMSS de Brasília + crachá), codigo_func, data_alerta, descricao, emissor (código de quem registrou).
Alertas com emissor PL1 e descrição iniciada por "Alerta gerado por 3 conflitos:" são gravados pela rotina diária de conflitos (regra 12; arquivo 8).

## conflitos (criada em 25/11/2026; gravada só pela rotina diária de conflitos, arquivo 8)
Um registro por tarefa do app em conflito com o WMS (regra 12: desde 26/11/2026, soma do tempo em comum com todas as tarefas do WMS maior que 5 minutos).
- id_conflito: número sequencial.
- codigo_func: crachá.
- id_registro: tarefa do app em conflito (única na tabela).
- nome_tarefa, inicio_app, fim_app: tarefa do app (UTC).
- numero_wms, tarefa_wms, aceite_wms, conclusao_wms: tarefa do WMS de maior sobreposição com a tarefa do app (UTC). Até 25/11/2026: a de aceite mais cedo com mais de 5 minutos em comum.
- inicio_sobreposicao: início do primeiro trecho em comum (UTC). Define o mês do conflito e a data do alerta.
- sobreposicao_seg: soma dos segundos em comum com todas as tarefas do WMS (sempre mais de 300).
- data_deteccao: quando a rotina gravou (UTC).
- id_alerta: alerta que usou este conflito; vazio = aguardando completar 3 no mês (sobras de meses passados ficam vazias para sempre).
Índices: id_registro (único), inicio_sobreposicao, (codigo_func, inicio_sobreposicao).

## Views úteis
- vw_registros: registros com nome, carga, doca e duracao_ms.
- vw_wms_tarefas: tarefas do WMS com nome do funcionário e dia (Brasília).
- vw_wms_resumo_dia: por dia, funcionário e tarefa do WMS: qtd_tarefas, itens, enderecos, execucao_seg.
