// Tarefas.gs - CRUD de tarefas e registros

// Listar tarefas ativas (cache de 10min)
function Tarefas_listar() {
  var dados = getSheetDataCached('Tarefas', 600);
  var headers = dados[0];

  var idxId = headers.indexOf('id_tarefa');
  var idxNome = headers.indexOf('nome');
  var idxUsaQr = headers.indexOf('usa_qrcode_carga');
  var idxTempo = headers.indexOf('tempo_maximo_min');
  var idxAtiva = headers.indexOf('ativa');

  var tarefas = [];
  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (row[idxAtiva]) {
      tarefas.push({
        id_tarefa: row[idxId],
        nome: row[idxNome],
        usa_qrcode_carga: row[idxUsaQr],
        tempo_maximo_min: row[idxTempo]
      });
    }
  }

  return { sucesso: true, dados: tarefas };
}

// Verificar status do funcionario (tarefa em andamento)
function Tarefas_statusFuncionario(codigoFunc) {
  if (!codigoFunc) {
    return { sucesso: false, mensagem: 'Código do funcionário não informado.' };
  }

  codigoFunc = codigoFunc.trim().toUpperCase();

  // Le apenas a aba quente (so tarefas em andamento) — evita varrer o historico
  var sheetReg = getSheet('RegistrosAbertos');
  var dados = sheetReg.getDataRange().getValues();
  var headers = dados[0];

  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxIdTarefa = headers.indexOf('id_tarefa');
  var idxNomeTarefa = headers.indexOf('nome_tarefa');
  var idxDataInicio = headers.indexOf('data_inicio');
  var idxStatus = headers.indexOf('status');

  // Procurar tarefa em andamento (de tras pra frente, mais recente primeiro)
  for (var i = dados.length - 1; i >= 1; i--) {
    var row = dados[i];
    if (String(row[idxCodFunc]).trim().toUpperCase() === codigoFunc &&
        row[idxStatus] === 'em_andamento') {

      var registro = {
        id_registro: row[idxId],
        id_tarefa: row[idxIdTarefa],
        nome_tarefa: row[idxNomeTarefa],
        data_inicio: formatarData(row[idxDataInicio]),
        status: row[idxStatus]
      };

      var carga = buscarCargaDoRegistro(row[idxId]);
      if (carga) {
        registro.carga = carga;
      }

      return {
        sucesso: true,
        dados: { tarefa_ativa: registro }
      };
    }
  }

  return {
    sucesso: true,
    dados: { tarefa_ativa: null }
  };
}

// Iniciar uma tarefa
function Tarefas_iniciar(codigoFunc, idTarefa) {
  if (!codigoFunc || !idTarefa) {
    return { sucesso: false, mensagem: 'Dados incompletos.' };
  }

  codigoFunc = codigoFunc.trim().toUpperCase();

  // Verificar se ja tem tarefa em andamento
  var statusAtual = Tarefas_statusFuncionario(codigoFunc);
  if (statusAtual.sucesso && statusAtual.dados.tarefa_ativa) {
    return { sucesso: false, mensagem: 'Você já tem uma tarefa em andamento. Finalize-a primeiro.' };
  }

  // Buscar nome da tarefa via cache
  var dadosTarefas = getSheetDataCached('Tarefas', 600);
  var headersTarefas = dadosTarefas[0];
  var idxIdTarefa = headersTarefas.indexOf('id_tarefa');
  var idxNomeTarefa = headersTarefas.indexOf('nome');

  var nomeTarefa = '';
  for (var i = 1; i < dadosTarefas.length; i++) {
    if (dadosTarefas[i][idxIdTarefa] === idTarefa) {
      nomeTarefa = dadosTarefas[i][idxNomeTarefa];
      break;
    }
  }

  if (!nomeTarefa) {
    return { sucesso: false, mensagem: 'Tarefa não encontrada.' };
  }

  var agora = new Date();
  var idRegistro = 'R' + Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + codigoFunc;

  // Nasce na aba quente; sera movida para o historico ao finalizar/dar timeout
  var sheetReg = getSheet('RegistrosAbertos');
  sheetReg.appendRow([
    idRegistro,
    codigoFunc,
    idTarefa,
    nomeTarefa,
    agora,
    '',
    'em_andamento',
    ''
  ]);

  return {
    sucesso: true,
    dados: {
      id_registro: idRegistro,
      id_tarefa: idTarefa,
      nome_tarefa: nomeTarefa,
      data_inicio: agora.toISOString(),
      status: 'em_andamento'
    },
    mensagem: 'Tarefa iniciada com sucesso.'
  };
}

// Finalizar uma tarefa
function Tarefas_finalizar(codigoFunc, idRegistro) {
  if (!codigoFunc || !idRegistro) {
    return { sucesso: false, mensagem: 'Dados incompletos.' };
  }

  codigoFunc = codigoFunc.trim().toUpperCase();

  var agora = new Date();

  // Caminho normal: a tarefa esta na aba quente. moverParaHistorico so move se
  // a linha existir E pertencer a este funcionario (checagem dentro da funcao).
  var movido = moverParaHistorico(idRegistro, agora, 'finalizada', 'funcionario', codigoFunc);
  if (movido) {
    return montarResultadoFinalizacao(idRegistro, agora.toISOString(), 'finalizada', true);
  }

  // Nao estava (mais) na aba quente. Duas situacoes legitimas caem aqui:
  //  (a) IDEMPOTENCIA: uma tentativa ANTERIOR ja finalizou. Isso acontece quando a
  //      primeira chamada demora, o app estoura o timeout de rede e faz retry — o
  //      registro ja foi movido. Sem este tratamento, o retry devolvia
  //      "Registro nao encontrado" mesmo tendo dado certo no servidor.
  //  (b) LEGADO: tarefa aberta que ficou na aba Registros (iniciada por codigo antigo
  //      durante a transicao de versao). Finalizamos no lugar.
  var sheetReg = getSheet('Registros');
  var dados = sheetReg.getDataRange().getValues();
  var headers = dados[0];
  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxDataFim = headers.indexOf('data_fim');
  var idxStatus = headers.indexOf('status');
  var idxFinalizadoPor = headers.indexOf('finalizado_por');

  for (var i = 1; i < dados.length; i++) {
    if (dados[i][idxId] === idRegistro &&
        String(dados[i][idxCodFunc]).trim().toUpperCase() === codigoFunc) {

      if (dados[i][idxStatus] === 'em_andamento') {
        // (b) legado aberto na aba Registros: finaliza no lugar
        sheetReg.getRange(i + 1, idxDataFim + 1).setValue(agora);
        sheetReg.getRange(i + 1, idxStatus + 1).setValue('finalizada');
        sheetReg.getRange(i + 1, idxFinalizadoPor + 1).setValue('funcionario');
        return montarResultadoFinalizacao(idRegistro, agora.toISOString(), 'finalizada', true);
      }

      // (a) ja finalizada/timeout: retorna sucesso (idempotente), sem regravar volumes
      return montarResultadoFinalizacao(idRegistro, formatarData(dados[i][idxDataFim]), dados[i][idxStatus], false);
    }
  }

  return { sucesso: false, mensagem: 'Registro não encontrado.' };
}

// Monta o resultado de uma finalizacao bem-sucedida, anexando a distribuicao da
// carga (se houver). recalcular=true tambem grava os volumes no historico.
function montarResultadoFinalizacao(idRegistro, dataFimIso, status, recalcular) {
  var resultado = {
    sucesso: true,
    dados: { id_registro: idRegistro, data_fim: dataFimIso, status: status },
    mensagem: 'Tarefa finalizada com sucesso.'
  };

  var carga = buscarCargaDoRegistro(idRegistro);
  if (carga) {
    var distribuicao = calcularDistribuicaoVolumes(carga.numero_carga, carga.qtd_volumes);
    resultado.dados.distribuicao = distribuicao;
    if (recalcular) {
      // Gravar volumes no Registros para que o historico leia sem recalcular
      salvarVolumesDistribuicao(carga.numero_carga, distribuicao);
    }
  }

  return resultado;
}

// Gravar volumes_proporcionais nas linhas de Registros de cada worker da carga.
// Chamado a cada finalizacao para que o historico leia o valor snapshot, sem recalcular.
function salvarVolumesDistribuicao(numeroCarga, distribuicao) {
  if (!distribuicao || distribuicao.length === 0) return;

  // Mapa codigo_func -> volumes (exclui o worker virtual AJUDANTE)
  var mapaVolumes = {};
  for (var d = 0; d < distribuicao.length; d++) {
    var cod = String(distribuicao[d].codigo_func).trim().toUpperCase();
    if (cod !== 'AJUDANTE') {
      mapaVolumes[cod] = distribuicao[d].volumes_proporcionais;
    }
  }

  // Mapear id_registro -> codigo_func para esta carga
  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var hCargas = dadosCargas[0];
  var idxCIdReg    = hCargas.indexOf('id_registro');
  var idxCCodFunc  = hCargas.indexOf('codigo_func');
  var idxCNumCarga = hCargas.indexOf('numero_carga');

  var idRegParaFunc = {};
  for (var c = 1; c < dadosCargas.length; c++) {
    if (dadosCargas[c][idxCNumCarga] === numeroCarga) {
      var cf = String(dadosCargas[c][idxCCodFunc]).trim().toUpperCase();
      idRegParaFunc[dadosCargas[c][idxCIdReg]] = cf;
    }
  }

  // Localizar (ou criar) coluna volumes_proporcionais em Registros
  var sheetReg = getSheet('Registros');
  var dadosReg = sheetReg.getDataRange().getValues();
  var hReg = dadosReg[0];
  var idxRegId  = hReg.indexOf('id_registro');
  var idxVolCol = hReg.indexOf('volumes_proporcionais');

  if (idxVolCol === -1) {
    idxVolCol = hReg.length;
    sheetReg.getRange(1, idxVolCol + 1).setValue('volumes_proporcionais');
  }

  // Atualizar cada linha cujo id_registro pertence a esta carga
  for (var r = 1; r < dadosReg.length; r++) {
    var idReg = dadosReg[r][idxRegId];
    if (idRegParaFunc[idReg] !== undefined) {
      var funcUpper = idRegParaFunc[idReg];
      if (mapaVolumes[funcUpper] !== undefined) {
        sheetReg.getRange(r + 1, idxVolCol + 1).setValue(mapaVolumes[funcUpper]);
      }
    }
  }
}

// Buscar carga associada a um registro
function buscarCargaDoRegistro(idRegistro) {
  var sheet = getSheet('Cargas');
  var dados = sheet.getDataRange().getValues();
  var headers = dados[0];

  var idxIdReg = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxNumCarga = headers.indexOf('numero_carga');
  var idxQtdVol = headers.indexOf('qtd_volumes');
  var idxDoca = headers.indexOf('doca');
  var idxDataLeitura = headers.indexOf('data_leitura');

  for (var i = 1; i < dados.length; i++) {
    if (dados[i][idxIdReg] === idRegistro) {
      var codigoDoca = idxDoca >= 0 ? dados[i][idxDoca] : '';
      return {
        numero_carga: dados[i][idxNumCarga],
        qtd_volumes: dados[i][idxQtdVol],
        doca: codigoDoca,
        nome_doca: buscarNomeDoca(codigoDoca),
        data_leitura: formatarData(dados[i][idxDataLeitura])
      };
    }
  }

  return null;
}

// Calcular distribuicao proporcional de volumes entre trabalhadores da mesma carga
function calcularDistribuicaoVolumes(numeroCarga, totalVolumes) {
  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];

  var idxIdReg = headersCargas.indexOf('id_registro');
  var idxCodFunc = headersCargas.indexOf('codigo_func');
  var idxNumCarga = headersCargas.indexOf('numero_carga');
  var idxAjudante = headersCargas.indexOf('ajudante');

  var registrosCarga = [];
  var temAjudante = false;
  for (var i = 1; i < dadosCargas.length; i++) {
    if (dadosCargas[i][idxNumCarga] === numeroCarga) {
      registrosCarga.push({
        id_registro: dadosCargas[i][idxIdReg],
        codigo_func: dadosCargas[i][idxCodFunc]
      });
      if (idxAjudante >= 0 && dadosCargas[i][idxAjudante] === true) {
        temAjudante = true;
      }
    }
  }

  if (registrosCarga.length === 0) return [];

  // Une historico + abertos: a carga pode ter workers finalizados e outros em andamento
  var mapaRegInfo = _indexarRegistrosPorId();

  // Usar cache para nomes de funcionarios
  var mapaNomes = buscarMapaNomes();

  var agora = new Date();

  var mapaWorkers = {};

  for (var j = 0; j < registrosCarga.length; j++) {
    var rc = registrosCarga[j];
    var codFunc = String(rc.codigo_func).trim().toUpperCase();

    var regInfo = mapaRegInfo[rc.id_registro];
    if (!regInfo) continue;

    var status = regInfo.status;
    if (status === 'timeout') continue;

    var dataInicio = new Date(regInfo.data_inicio);
    var dataFim = status === 'finalizada'
      ? new Date(regInfo.data_fim)
      : agora;
    var tempoMs = Math.max(dataFim.getTime() - dataInicio.getTime(), 60000);

    if (!mapaWorkers[codFunc]) {
      mapaWorkers[codFunc] = {
        codigo_func: rc.codigo_func,
        nome_func: mapaNomes[codFunc] || rc.codigo_func,
        tempo_ms: 0,
        status: status,
        data_inicio: dataInicio.toISOString(),
        data_fim: dataFim.toISOString()
      };
    } else {
      // Manter o menor inicio e maior fim para o calculo correto do ajudante
      if (dataInicio.getTime() < new Date(mapaWorkers[codFunc].data_inicio).getTime()) {
        mapaWorkers[codFunc].data_inicio = dataInicio.toISOString();
      }
      if (dataFim.getTime() > new Date(mapaWorkers[codFunc].data_fim).getTime()) {
        mapaWorkers[codFunc].data_fim = dataFim.toISOString();
      }
    }

    mapaWorkers[codFunc].tempo_ms += tempoMs;

    if (status === 'finalizada') {
      mapaWorkers[codFunc].status = 'finalizada';
    }
  }

  var workersFinalizados = [];
  var workersEmAndamento = [];

  for (var cod in mapaWorkers) {
    if (mapaWorkers[cod].status === 'finalizada') {
      workersFinalizados.push(mapaWorkers[cod]);
    } else {
      workersEmAndamento.push(mapaWorkers[cod]);
    }
  }

  var workers = workersFinalizados.length > 0 ? workersFinalizados : workersEmAndamento;

  if (workers.length === 0) return [];

  if (temAjudante) {
    var menorInicio = Infinity;
    var maiorFim = 0;
    for (var a = 0; a < workers.length; a++) {
      var iniMs = new Date(workers[a].data_inicio).getTime();
      var fimMs = new Date(workers[a].data_fim).getTime();
      if (iniMs < menorInicio) menorInicio = iniMs;
      if (fimMs > maiorFim) maiorFim = fimMs;
    }
    var tempoAjudante = Math.max(maiorFim - menorInicio, 60000);
    workers.push({
      codigo_func: 'AJUDANTE',
      nome_func: 'Ajudante',
      tempo_ms: tempoAjudante,
      status: workersFinalizados.length > 0 ? 'finalizada' : 'em_andamento',
      data_inicio: new Date(menorInicio).toISOString(),
      data_fim: new Date(maiorFim).toISOString()
    });
  }

  var tempoTotal = 0;
  for (var w = 0; w < workers.length; w++) {
    tempoTotal += workers[w].tempo_ms;
  }

  var volumesDistribuidos = 0;
  for (var w2 = 0; w2 < workers.length; w2++) {
    var volumesProporcional;

    if (w2 === workers.length - 1) {
      volumesProporcional = totalVolumes - volumesDistribuidos;
    } else {
      volumesProporcional = Math.round((workers[w2].tempo_ms / tempoTotal) * totalVolumes);
      volumesDistribuidos += volumesProporcional;
    }

    workers[w2].volumes_proporcionais = volumesProporcional;
    workers[w2].percentual = ((workers[w2].tempo_ms / tempoTotal) * 100).toFixed(1);
  }

  return workers;
}
