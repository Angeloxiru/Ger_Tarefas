// Timeout.gs - Logica de auto-timeout (trigger agendado)
// Este trigger deve ser configurado para rodar a cada 30 minutos

// Funcao principal do trigger de timeout
function verificarTimeouts() {
  // Varre apenas a aba quente (poucas linhas): so ali existem tarefas em andamento
  var sheetAbertas = getSheet('RegistrosAbertos');
  var dados = sheetAbertas.getDataRange().getValues();
  var headers = dados[0];

  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxIdTarefa = headers.indexOf('id_tarefa');
  var idxDataInicio = headers.indexOf('data_inicio');

  // Sair antecipadamente se nao houver nenhuma tarefa aberta
  if (dados.length <= 1) return;

  // Tarefas via cache (10min) para buscar tempo maximo de cada tarefa
  var dadosTarefas = getSheetDataCached('Tarefas', 600);
  var headersTarefas = dadosTarefas[0];
  var idxTarefaId = headersTarefas.indexOf('id_tarefa');
  var idxTarefaTempo = headersTarefas.indexOf('tempo_maximo_min');

  var tempoMaximoMap = {};
  for (var t = 1; t < dadosTarefas.length; t++) {
    tempoMaximoMap[dadosTarefas[t][idxTarefaId]] = dadosTarefas[t][idxTarefaTempo] || getConfigValor('timeout_padrao_min', 240);
  }

  var timeoutPadrao = getConfigValor('timeout_padrao_min', 240);

  var agora = new Date();
  var agoraMs = agora.getTime();

  // 1) Coletar os ids expirados sem alterar a aba durante a leitura
  var expirados = [];
  for (var i = 1; i < dados.length; i++) {
    var dataInicio = new Date(dados[i][idxDataInicio]);
    var tempoDecorridoMin = (agoraMs - dataInicio.getTime()) / 60000;
    var tempoMaximo = tempoMaximoMap[dados[i][idxIdTarefa]] || timeoutPadrao;

    if (tempoDecorridoMin >= tempoMaximo) {
      expirados.push({ id: dados[i][idxId], codigo_func: dados[i][idxCodFunc] });
    }
  }

  // 2) Mover cada expirado para o historico como timeout e recalcular a carga
  var timeoutsRealizados = 0;
  for (var e = 0; e < expirados.length; e++) {
    var movido = moverParaHistorico(expirados[e].id, agora, 'timeout', 'sistema');
    if (!movido || movido.ocupado) continue;

    timeoutsRealizados++;
    Logger.log('Timeout realizado: ' + expirados[e].id + ' - Func: ' + expirados[e].codigo_func);

    var carga = buscarCargaDoRegistro(expirados[e].id);
    if (carga) {
      Logger.log('Func ' + expirados[e].codigo_func + ' excluido da distribuicao da carga ' + carga.numero_carga + ' por timeout.');
      // Recalcular e salvar distribuicao para os demais workers (excluindo este que deu timeout)
      var dist = calcularDistribuicaoVolumes(carga.numero_carga, carga.qtd_volumes);
      if (dist && dist.length > 0) {
        salvarVolumesDistribuicao(carga.numero_carga, dist);
      }
    }
  }

  if (timeoutsRealizados > 0) {
    Logger.log('Total de timeouts realizados: ' + timeoutsRealizados);
  }
}

// Configurar trigger automatico (executar apenas uma vez para configurar)
function configurarTriggerTimeout() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'verificarTimeouts') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('verificarTimeouts')
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log('Trigger de timeout configurado com sucesso (a cada 30 minutos).');
}
