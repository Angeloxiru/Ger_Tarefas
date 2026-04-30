// Carregamento.gs - Funcoes especificas de carregamento
// Suporta multiplos trabalhadores na mesma carga com distribuicao proporcional

// Registrar leitura de QRcode de carga
function Carregamento_registrar(dados) {
  if (!dados.codigo_func || !dados.id_registro || !dados.numero_carga || !dados.qtd_volumes) {
    return { sucesso: false, mensagem: 'Dados incompletos para registrar carga.' };
  }

  var sheet = getSheet('Cargas');
  var agora = new Date();

  var existente = buscarCargaDoRegistro(dados.id_registro);
  if (existente) {
    return { sucesso: false, mensagem: 'Este registro já tem uma carga associada.' };
  }

  sheet.appendRow([
    dados.id_registro,
    dados.codigo_func,
    dados.numero_carga,
    dados.qtd_volumes,
    dados.doca || '',
    agora,
    dados.ajudante === 'true' || dados.ajudante === true
  ]);

  var resultWorkers = buscarWorkersDaCarga(dados.numero_carga);
  var totalWorkers = resultWorkers.registros.length;

  return {
    sucesso: true,
    dados: {
      numero_carga: dados.numero_carga,
      qtd_volumes: dados.qtd_volumes,
      total_workers: totalWorkers,
      compartilhada: totalWorkers > 1
    },
    mensagem: totalWorkers > 1
      ? 'Carga registrada. ' + totalWorkers + ' trabalhadores nesta carga. Volumes serão distribuídos proporcionalmente.'
      : 'Carga registrada com sucesso.'
  };
}

// Buscar todos os trabalhadores de uma mesma carga
function buscarWorkersDaCarga(numeroCarga) {
  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];

  var idxIdReg = headersCargas.indexOf('id_registro');
  var idxCodFunc = headersCargas.indexOf('codigo_func');
  var idxNumCarga = headersCargas.indexOf('numero_carga');
  var idxAjudante = headersCargas.indexOf('ajudante');

  var registros = [];
  var temAjudante = false;
  for (var i = 1; i < dadosCargas.length; i++) {
    if (dadosCargas[i][idxNumCarga] === numeroCarga) {
      registros.push({
        id_registro: dadosCargas[i][idxIdReg],
        codigo_func: dadosCargas[i][idxCodFunc]
      });
      if (idxAjudante >= 0 && dadosCargas[i][idxAjudante] === true) {
        temAjudante = true;
      }
    }
  }

  return { registros: registros, tem_ajudante: temAjudante };
}

// Endpoint: buscar workers de uma carga (para monitoramento em tempo real)
function Carregamento_workersCarga(numeroCarga) {
  if (!numeroCarga) {
    return { sucesso: false, mensagem: 'Número da carga não informado.' };
  }

  var resultBusca = buscarWorkersDaCarga(numeroCarga);
  var registrosCarga = resultBusca.registros;
  var temAjudante = resultBusca.tem_ajudante;

  if (registrosCarga.length === 0) {
    return { sucesso: true, dados: { workers: [], total: 0, tem_ajudante: false } };
  }

  var sheetReg = getSheet('Registros');
  var dadosReg = sheetReg.getDataRange().getValues();
  var headersReg = dadosReg[0];

  var idxRegId = headersReg.indexOf('id_registro');
  var idxRegDataInicio = headersReg.indexOf('data_inicio');
  var idxRegDataFim = headersReg.indexOf('data_fim');
  var idxRegStatus = headersReg.indexOf('status');

  // Nomes via cache
  var mapaNomes = buscarMapaNomes();

  // Agrupar por funcionario unico, rastreando min inicio e max fim entre sessoes
  var mapaWorkers = {};
  for (var j = 0; j < registrosCarga.length; j++) {
    var rc = registrosCarga[j];
    var codFunc = String(rc.codigo_func).trim().toUpperCase();

    for (var k = 1; k < dadosReg.length; k++) {
      if (dadosReg[k][idxRegId] === rc.id_registro) {
        var status = dadosReg[k][idxRegStatus];
        var dataInicio = dadosReg[k][idxRegDataInicio];
        var dataFim = dadosReg[k][idxRegDataFim];
        var inicioMs = new Date(dataInicio).getTime();
        var fimMs = dataFim ? new Date(dataFim).getTime() : null;

        if (!mapaWorkers[codFunc]) {
          mapaWorkers[codFunc] = {
            codigo_func: rc.codigo_func,
            nome_func: mapaNomes[codFunc] || rc.codigo_func,
            data_inicio: formatarData(dataInicio),
            data_fim: fimMs ? formatarData(dataFim) : null,
            _inicioMs: inicioMs,
            _fimMs: fimMs,
            status: status
          };
        } else {
          // Menor inicio entre todas as sessoes
          if (inicioMs < mapaWorkers[codFunc]._inicioMs) {
            mapaWorkers[codFunc]._inicioMs = inicioMs;
            mapaWorkers[codFunc].data_inicio = formatarData(dataInicio);
          }
          // Sessao em andamento: data_fim fica nula; senao guardar o maior fim
          if (fimMs === null) {
            mapaWorkers[codFunc]._fimMs = null;
            mapaWorkers[codFunc].data_fim = null;
            mapaWorkers[codFunc].status = 'em_andamento';
          } else if (mapaWorkers[codFunc]._fimMs !== null && fimMs > mapaWorkers[codFunc]._fimMs) {
            mapaWorkers[codFunc]._fimMs = fimMs;
            mapaWorkers[codFunc].data_fim = formatarData(dataFim);
          }
          if (status === 'finalizada' && mapaWorkers[codFunc].status !== 'em_andamento') {
            mapaWorkers[codFunc].status = 'finalizada';
          }
        }
        break;
      }
    }
  }

  var workers = [];
  for (var cod in mapaWorkers) {
    var w = mapaWorkers[cod];
    workers.push({
      codigo_func: w.codigo_func,
      nome_func: w.nome_func,
      data_inicio: w.data_inicio,
      data_fim: w.data_fim,
      status: w.status
    });
  }

  // Buscar total de volumes (reutilizando dadosCargas ja lidos)
  var sheetCargasAll = getSheet('Cargas');
  var dadosCargasAll = sheetCargasAll.getDataRange().getValues();
  var headersCargasAll = dadosCargasAll[0];
  var idxQtdVol = headersCargasAll.indexOf('qtd_volumes');
  var idxNumCargaAll = headersCargasAll.indexOf('numero_carga');

  var totalVolumes = 0;
  for (var c = 1; c < dadosCargasAll.length; c++) {
    if (dadosCargasAll[c][idxNumCargaAll] === numeroCarga) {
      totalVolumes = dadosCargasAll[c][idxQtdVol];
      break;
    }
  }

  return {
    sucesso: true,
    dados: {
      workers: workers,
      total: workers.length,
      qtd_volumes: totalVolumes,
      tem_ajudante: temAjudante
    }
  };
}

// Endpoint: buscar distribuicao calculada de uma carga (para gestor)
function Carregamento_distribuicao(numeroCarga) {
  if (!numeroCarga) {
    return { sucesso: false, mensagem: 'Número da carga não informado.' };
  }

  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];
  var idxNumCarga = headersCargas.indexOf('numero_carga');
  var idxQtdVol = headersCargas.indexOf('qtd_volumes');

  var totalVolumes = 0;
  for (var i = 1; i < dadosCargas.length; i++) {
    if (dadosCargas[i][idxNumCarga] === numeroCarga) {
      totalVolumes = dadosCargas[i][idxQtdVol];
      break;
    }
  }

  if (totalVolumes === 0) {
    return { sucesso: false, mensagem: 'Carga não encontrada.' };
  }

  var distribuicao = calcularDistribuicaoVolumes(numeroCarga, totalVolumes);

  return {
    sucesso: true,
    dados: {
      numero_carga: numeroCarga,
      qtd_volumes: totalVolumes,
      distribuicao: distribuicao
    }
  };
}
