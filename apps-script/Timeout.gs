// Timeout.gs - Logica de auto-timeout (trigger agendado)
// Este trigger deve ser configurado para rodar a cada 30 minutos

// Funcao principal do trigger de timeout
function verificarTimeouts() {
  var sheetReg = getSheet('Registros');
  var dados = sheetReg.getDataRange().getValues();
  var headers = dados[0];

  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxIdTarefa = headers.indexOf('id_tarefa');
  var idxDataInicio = headers.indexOf('data_inicio');
  var idxDataFim = headers.indexOf('data_fim');
  var idxStatus = headers.indexOf('status');
  var idxFinalizadoPor = headers.indexOf('finalizado_por');

  // Sair antecipadamente se nao houver nenhum registro em andamento
  var temAtivos = false;
  for (var x = 1; x < dados.length; x++) {
    if (dados[x][idxStatus] === 'em_andamento') { temAtivos = true; break; }
  }
  if (!temAtivos) return;

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
  var timeoutsRealizados = 0;

  for (var i = 1; i < dados.length; i++) {
    if (dados[i][idxStatus] !== 'em_andamento') continue;

    var dataInicio = new Date(dados[i][idxDataInicio]);
    var tempoDecorridoMin = (agoraMs - dataInicio.getTime()) / 60000;

    var idTarefa = dados[i][idxIdTarefa];
    var tempoMaximo = tempoMaximoMap[idTarefa] || timeoutPadrao;

    if (tempoDecorridoMin >= tempoMaximo) {
      sheetReg.getRange(i + 1, idxDataFim + 1).setValue(agora);
      sheetReg.getRange(i + 1, idxStatus + 1).setValue('timeout');
      sheetReg.getRange(i + 1, idxFinalizadoPor + 1).setValue('sistema');

      timeoutsRealizados++;

      Logger.log('Timeout realizado: ' + dados[i][idxId] + ' - Func: ' + dados[i][idxCodFunc]);

      var carga = buscarCargaDoRegistro(dados[i][idxId]);
      if (carga) {
        Logger.log('Func ' + dados[i][idxCodFunc] + ' excluido da distribuicao da carga ' + carga.numero_carga + ' por timeout.');
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
