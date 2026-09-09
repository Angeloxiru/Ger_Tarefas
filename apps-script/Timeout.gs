// Timeout.gs - Logica de auto-timeout (trigger agendado)
// Este trigger deve ser configurado para rodar a cada 30 minutos

// Funcao principal do trigger de timeout.
// Encerra tarefas vencidas nas DUAS abas: a quente (RegistrosAbertos, fluxo normal)
// e, por robustez, tarefas em_andamento que tenham ficado presas na aba Registros
// (legado da transicao de versao). Assim nenhuma tarefa escapa do timeout.
function verificarTimeouts() {
  // Mapa de tempo maximo por tarefa (cache) + padrao
  var dadosTarefas = getSheetDataCached('Tarefas', 600);
  var hT = dadosTarefas[0];
  var idxTarefaId = hT.indexOf('id_tarefa');
  var idxTarefaTempo = hT.indexOf('tempo_maximo_min');
  var timeoutPadrao = getConfigValor('timeout_padrao_min', 240);
  var tempoMaximoMap = {};
  for (var t = 1; t < dadosTarefas.length; t++) {
    tempoMaximoMap[dadosTarefas[t][idxTarefaId]] = dadosTarefas[t][idxTarefaTempo] || timeoutPadrao;
  }

  var agora = new Date();
  var agoraMs = agora.getTime();
  var total = 0;

  // 1) Fluxo normal: tarefas em andamento na aba quente RegistrosAbertos
  var abertas = getSheet('RegistrosAbertos').getDataRange().getValues();
  if (abertas.length > 1) {
    var hA = abertas[0];
    var aId = hA.indexOf('id_registro');
    var aCod = hA.indexOf('codigo_func');
    var aTar = hA.indexOf('id_tarefa');
    var aIni = hA.indexOf('data_inicio');

    var expirados = [];
    for (var i = 1; i < abertas.length; i++) {
      var decorridoMin = (agoraMs - new Date(abertas[i][aIni]).getTime()) / 60000;
      var maxMin = tempoMaximoMap[abertas[i][aTar]] || timeoutPadrao;
      if (!isNaN(decorridoMin) && decorridoMin >= maxMin) {
        expirados.push({ id: abertas[i][aId], codigo_func: abertas[i][aCod] });
      }
    }
    for (var e = 0; e < expirados.length; e++) {
      var movido = moverParaHistorico(expirados[e].id, agora, 'timeout', 'sistema');
      if (!movido || movido.ocupado) continue;
      total++;
      Logger.log('Timeout (abertas): ' + expirados[e].id + ' - ' + expirados[e].codigo_func);
      timeoutRecalcularCarga(expirados[e].id);
    }
  }

  // 2) Robustez: em_andamento presas na aba Registros (legado) -> timeout no lugar
  total += timeoutLegadoRegistros(tempoMaximoMap, timeoutPadrao, agora, agoraMs);

  if (total > 0) Logger.log('Total de timeouts realizados: ' + total);
  return total;
}

// Encerra por timeout as tarefas em_andamento que ficaram na aba Registros (legado
// da transicao). Marca no lugar (nao move de aba), garantindo que sejam encerradas
// mesmo que nunca tenham sido migradas para RegistrosAbertos.
function timeoutLegadoRegistros(tempoMaximoMap, timeoutPadrao, agora, agoraMs) {
  var sheetReg = getSheet('Registros');
  var dados = sheetReg.getDataRange().getValues();
  var h = dados[0];
  var idxStatus = h.indexOf('status');

  var temAberto = false;
  for (var x = 1; x < dados.length; x++) {
    if (dados[x][idxStatus] === 'em_andamento') { temAberto = true; break; }
  }
  if (!temAberto) return 0;

  var idxId = h.indexOf('id_registro');
  var idxCod = h.indexOf('codigo_func');
  var idxTar = h.indexOf('id_tarefa');
  var idxIni = h.indexOf('data_inicio');
  var idxFim = h.indexOf('data_fim');
  var idxFinPor = h.indexOf('finalizado_por');

  var feitos = 0;
  for (var i = 1; i < dados.length; i++) {
    if (dados[i][idxStatus] !== 'em_andamento') continue;
    var decorridoMin = (agoraMs - new Date(dados[i][idxIni]).getTime()) / 60000;
    var maxMin = tempoMaximoMap[dados[i][idxTar]] || timeoutPadrao;
    if (isNaN(decorridoMin) || decorridoMin < maxMin) continue;

    sheetReg.getRange(i + 1, idxFim + 1).setValue(agora);
    sheetReg.getRange(i + 1, idxStatus + 1).setValue('timeout');
    sheetReg.getRange(i + 1, idxFinPor + 1).setValue('sistema');
    feitos++;
    Logger.log('Timeout (legado Registros): ' + dados[i][idxId] + ' - ' + dados[i][idxCod]);
    timeoutRecalcularCarga(dados[i][idxId]);
  }
  return feitos;
}

// Recalcula e salva a distribuicao da carga de um registro que deu timeout (se houver).
function timeoutRecalcularCarga(idRegistro) {
  var carga = buscarCargaDoRegistro(idRegistro);
  if (!carga) return;
  var dist = calcularDistribuicaoVolumes(carga.numero_carga, carga.qtd_volumes);
  if (dist && dist.length > 0) salvarVolumesDistribuicao(carga.numero_carga, dist);
}

// Diagnostico (rodar no editor): informa se o gatilho esta instalado e quantas
// tarefas estao vencidas AGORA em cada aba. Use para descobrir por que o timeout
// nao esta finalizando: se "instalado: NAO", rode configurarTriggerTimeout().
function diagnosticoTimeout() {
  var triggers = ScriptApp.getProjectTriggers();
  var nTrig = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'verificarTimeouts') nTrig++;
  }

  var dadosTarefas = getSheetDataCached('Tarefas', 600);
  var hT = dadosTarefas[0];
  var idxTarefaId = hT.indexOf('id_tarefa');
  var idxTarefaTempo = hT.indexOf('tempo_maximo_min');
  var timeoutPadrao = getConfigValor('timeout_padrao_min', 240);
  var tempoMaximoMap = {};
  for (var t = 1; t < dadosTarefas.length; t++) {
    tempoMaximoMap[dadosTarefas[t][idxTarefaId]] = dadosTarefas[t][idxTarefaTempo] || timeoutPadrao;
  }
  var agoraMs = Date.now();

  function contarVencidas(nomeAba) {
    var d = getSheet(nomeAba).getDataRange().getValues();
    if (d.length <= 1) return 0;
    var h = d[0];
    var iTar = h.indexOf('id_tarefa'), iIni = h.indexOf('data_inicio'), iSt = h.indexOf('status');
    var n = 0;
    for (var i = 1; i < d.length; i++) {
      if (iSt >= 0 && d[i][iSt] !== 'em_andamento') continue;
      var min = (agoraMs - new Date(d[i][iIni]).getTime()) / 60000;
      var max = tempoMaximoMap[d[i][iTar]] || timeoutPadrao;
      if (!isNaN(min) && min >= max) n++;
    }
    return n;
  }

  var r = {
    trigger_instalado: nTrig,
    vencidas_abertas: contarVencidas('RegistrosAbertos'),
    vencidas_legado_registros: contarVencidas('Registros')
  };
  Logger.log('diagnosticoTimeout: gatilho=' + (nTrig > 0 ? 'SIM(' + nTrig + ')' : 'NAO') +
             ' | vencidas RegistrosAbertos=' + r.vencidas_abertas +
             ' | vencidas Registros(legado)=' + r.vencidas_legado_registros);
  return r;
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
