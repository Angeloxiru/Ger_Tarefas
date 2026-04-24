// Tarefas.gs - CRUD de tarefas e registros

// Listar tarefas ativas
function Tarefas_listar() {
  var sheet = getSheet('Tarefas');
  var dados = sheet.getDataRange().getValues();
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
    return { sucesso: false, mensagem: 'Codigo do funcionario nao informado.' };
  }

  codigoFunc = codigoFunc.trim().toUpperCase();

  var sheetReg = getSheet('Registros');
  var dados = sheetReg.getDataRange().getValues();
  var headers = dados[0];

  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxIdTarefa = headers.indexOf('id_tarefa');
  var idxNomeTarefa = headers.indexOf('nome_tarefa');
  var idxDataInicio = headers.indexOf('data_inicio');
  var idxDataFim = headers.indexOf('data_fim');
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

      // Buscar dados de carga se existir
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
    return { sucesso: false, mensagem: 'Voce ja tem uma tarefa em andamento. Finalize-a primeiro.' };
  }

  // Buscar nome da tarefa
  var sheetTarefas = getSheet('Tarefas');
  var tarefas = sheetTarefas.getDataRange().getValues();
  var headersTarefas = tarefas[0];
  var idxIdTarefa = headersTarefas.indexOf('id_tarefa');
  var idxNomeTarefa = headersTarefas.indexOf('nome');

  var nomeTarefa = '';
  for (var i = 1; i < tarefas.length; i++) {
    if (tarefas[i][idxIdTarefa] === idTarefa) {
      nomeTarefa = tarefas[i][idxNomeTarefa];
      break;
    }
  }

  if (!nomeTarefa) {
    return { sucesso: false, mensagem: 'Tarefa nao encontrada.' };
  }

  // Criar registro
  var agora = new Date();
  var idRegistro = 'R' + Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + codigoFunc;

  var sheetReg = getSheet('Registros');
  sheetReg.appendRow([
    idRegistro,
    codigoFunc,
    idTarefa,
    nomeTarefa,
    agora,
    '',          // data_fim vazio
    'em_andamento',
    ''           // finalizado_por vazio
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

      if (dados[i][idxStatus] !== 'em_andamento') {
        return { sucesso: false, mensagem: 'Esta tarefa ja foi finalizada.' };
      }

      var agora = new Date();

      // Atualizar registro (linha i+1 porque getDataRange inclui header)
      sheetReg.getRange(i + 1, idxDataFim + 1).setValue(agora);
      sheetReg.getRange(i + 1, idxStatus + 1).setValue('finalizada');
      sheetReg.getRange(i + 1, idxFinalizadoPor + 1).setValue('funcionario');

      var resultado = {
        sucesso: true,
        dados: {
          id_registro: idRegistro,
          data_fim: agora.toISOString(),
          status: 'finalizada'
        },
        mensagem: 'Tarefa finalizada com sucesso.'
      };

      // Se tinha carga, calcular distribuicao proporcional
      var carga = buscarCargaDoRegistro(idRegistro);
      if (carga) {
        var distribuicao = calcularDistribuicaoVolumes(carga.numero_carga, carga.qtd_volumes);
        resultado.dados.distribuicao = distribuicao;
      }

      return resultado;
    }
  }

  return { sucesso: false, mensagem: 'Registro nao encontrado.' };
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
      return {
        numero_carga: dados[i][idxNumCarga],
        qtd_volumes: dados[i][idxQtdVol],
        doca: idxDoca >= 0 ? dados[i][idxDoca] : '',
        data_leitura: formatarData(dados[i][idxDataLeitura])
      };
    }
  }

  return null;
}

// Calcular distribuicao proporcional de volumes entre trabalhadores da mesma carga
// Agrega por funcionario unico (se o mesmo func tem multiplos registros, soma os tempos)
function calcularDistribuicaoVolumes(numeroCarga, totalVolumes) {
  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];

  var idxIdReg = headersCargas.indexOf('id_registro');
  var idxCodFunc = headersCargas.indexOf('codigo_func');
  var idxNumCarga = headersCargas.indexOf('numero_carga');

  var registrosCarga = [];
  for (var i = 1; i < dadosCargas.length; i++) {
    if (dadosCargas[i][idxNumCarga] === numeroCarga) {
      registrosCarga.push({
        id_registro: dadosCargas[i][idxIdReg],
        codigo_func: dadosCargas[i][idxCodFunc]
      });
    }
  }

  if (registrosCarga.length === 0) return [];

  var sheetReg = getSheet('Registros');
  var dadosReg = sheetReg.getDataRange().getValues();
  var headersReg = dadosReg[0];

  var idxRegId = headersReg.indexOf('id_registro');
  var idxRegDataInicio = headersReg.indexOf('data_inicio');
  var idxRegDataFim = headersReg.indexOf('data_fim');
  var idxRegStatus = headersReg.indexOf('status');

  var sheetFunc = getSheet('Funcionarios');
  var dadosFunc = sheetFunc.getDataRange().getValues();
  var headersFunc = dadosFunc[0];
  var idxFuncCodigo = headersFunc.indexOf('codigo');
  var idxFuncNome = headersFunc.indexOf('nome');

  var mapaNomes = {};
  for (var f = 1; f < dadosFunc.length; f++) {
    mapaNomes[String(dadosFunc[f][idxFuncCodigo]).trim().toUpperCase()] = dadosFunc[f][idxFuncNome];
  }

  var agora = new Date();

  // Agrupar por funcionario unico, somando tempos de multiplos registros
  var mapaWorkers = {};

  for (var j = 0; j < registrosCarga.length; j++) {
    var rc = registrosCarga[j];
    var codFunc = String(rc.codigo_func).trim().toUpperCase();

    for (var k = 1; k < dadosReg.length; k++) {
      if (dadosReg[k][idxRegId] === rc.id_registro) {
        var status = dadosReg[k][idxRegStatus];

        if (status === 'timeout') break;

        var dataInicio = new Date(dadosReg[k][idxRegDataInicio]);
        var dataFim = status === 'finalizada'
          ? new Date(dadosReg[k][idxRegDataFim])
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
        }

        mapaWorkers[codFunc].tempo_ms += tempoMs;

        // Se qualquer registro esta finalizado, o worker conta como finalizado
        if (status === 'finalizada') {
          mapaWorkers[codFunc].status = 'finalizada';
        }

        break;
      }
    }
  }

  // Separar finalizados e em_andamento
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
