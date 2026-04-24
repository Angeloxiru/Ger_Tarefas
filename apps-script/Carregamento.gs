// Carregamento.gs - Funcoes especificas de carregamento
// Suporta multiplos trabalhadores na mesma carga com distribuicao proporcional

// Registrar leitura de QRcode de carga
function Carregamento_registrar(dados) {
  if (!dados.codigo_func || !dados.id_registro || !dados.numero_carga || !dados.qtd_volumes) {
    return { sucesso: false, mensagem: 'Dados incompletos para registrar carga.' };
  }

  var sheet = getSheet('Cargas');
  var agora = new Date();

  // Verificar se este registro ja tem uma carga associada
  var existente = buscarCargaDoRegistro(dados.id_registro);
  if (existente) {
    return { sucesso: false, mensagem: 'Este registro ja tem uma carga associada.' };
  }

  // Registrar nova carga
  sheet.appendRow([
    dados.id_registro,
    dados.codigo_func,
    dados.numero_carga,
    dados.qtd_volumes,
    dados.doca || '',
    agora
  ]);

  // Verificar se ha outros trabalhadores na mesma carga
  var workers = buscarWorkersDaCarga(dados.numero_carga);
  var totalWorkers = workers.length;

  return {
    sucesso: true,
    dados: {
      numero_carga: dados.numero_carga,
      qtd_volumes: dados.qtd_volumes,
      total_workers: totalWorkers,
      compartilhada: totalWorkers > 1
    },
    mensagem: totalWorkers > 1
      ? 'Carga registrada. ' + totalWorkers + ' trabalhadores nesta carga. Volumes serao distribuidos proporcionalmente.'
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

  var registros = [];
  for (var i = 1; i < dadosCargas.length; i++) {
    if (dadosCargas[i][idxNumCarga] === numeroCarga) {
      registros.push({
        id_registro: dadosCargas[i][idxIdReg],
        codigo_func: dadosCargas[i][idxCodFunc]
      });
    }
  }

  return registros;
}

// Endpoint: buscar workers de uma carga (para monitoramento em tempo real)
function Carregamento_workersCarga(numeroCarga) {
  if (!numeroCarga) {
    return { sucesso: false, mensagem: 'Numero da carga nao informado.' };
  }

  var registrosCarga = buscarWorkersDaCarga(numeroCarga);

  if (registrosCarga.length === 0) {
    return { sucesso: true, dados: { workers: [], total: 0 } };
  }

  // Buscar dados completos dos registros
  var sheetReg = getSheet('Registros');
  var dadosReg = sheetReg.getDataRange().getValues();
  var headersReg = dadosReg[0];

  var idxRegId = headersReg.indexOf('id_registro');
  var idxRegCodFunc = headersReg.indexOf('codigo_func');
  var idxRegDataInicio = headersReg.indexOf('data_inicio');
  var idxRegDataFim = headersReg.indexOf('data_fim');
  var idxRegStatus = headersReg.indexOf('status');

  // Buscar nomes
  var sheetFunc = getSheet('Funcionarios');
  var dadosFunc = sheetFunc.getDataRange().getValues();
  var headersFunc = dadosFunc[0];
  var idxFuncCodigo = headersFunc.indexOf('codigo');
  var idxFuncNome = headersFunc.indexOf('nome');

  var mapaNomes = {};
  for (var f = 1; f < dadosFunc.length; f++) {
    mapaNomes[String(dadosFunc[f][idxFuncCodigo]).trim().toUpperCase()] = dadosFunc[f][idxFuncNome];
  }

  // Agrupar por funcionario unico (mesmo func pode ter multiplos registros na mesma carga)
  var mapaWorkers = {};
  for (var j = 0; j < registrosCarga.length; j++) {
    var rc = registrosCarga[j];
    var codFunc = String(rc.codigo_func).trim().toUpperCase();

    for (var k = 1; k < dadosReg.length; k++) {
      if (dadosReg[k][idxRegId] === rc.id_registro) {
        var status = dadosReg[k][idxRegStatus];
        var dataInicio = dadosReg[k][idxRegDataInicio];
        var dataFim = dadosReg[k][idxRegDataFim];

        if (!mapaWorkers[codFunc]) {
          mapaWorkers[codFunc] = {
            codigo_func: rc.codigo_func,
            nome_func: mapaNomes[codFunc] || rc.codigo_func,
            data_inicio: formatarData(dataInicio),
            data_fim: dataFim ? formatarData(dataFim) : null,
            status: status
          };
        } else {
          if (status === 'finalizada') mapaWorkers[codFunc].status = 'finalizada';
          if (status === 'em_andamento') {
            mapaWorkers[codFunc].data_fim = null;
            if (mapaWorkers[codFunc].status !== 'finalizada') {
              mapaWorkers[codFunc].status = 'em_andamento';
            }
          }
        }
        break;
      }
    }
  }

  var workers = [];
  for (var cod in mapaWorkers) {
    workers.push(mapaWorkers[cod]);
  }

  // Buscar total de volumes da carga
  var sheetCargasAll = getSheet('Cargas');
  var dadosCargasAll = sheetCargasAll.getDataRange().getValues();
  var headersCargasAll = dadosCargasAll[0];
  var idxQtdVol = headersCargasAll.indexOf('qtd_volumes');
  var idxNumCargaAll = headersCargasAll.indexOf('numero_carga');

  var totalVolumes = 0;
  for (var c = 1; c < dadosCargasAll.length; c++) {
    if (dadosCargasAll[c][idxNumCargaAll] === numeroCarga) {
      totalVolumes = dadosCargasAll[c][idxQtdVol];
      break; // Todas as entradas da mesma carga tem o mesmo total
    }
  }

  return {
    sucesso: true,
    dados: {
      workers: workers,
      total: workers.length,
      qtd_volumes: totalVolumes
    }
  };
}

// Endpoint: buscar distribuicao calculada de uma carga (para gestor)
function Carregamento_distribuicao(numeroCarga) {
  if (!numeroCarga) {
    return { sucesso: false, mensagem: 'Numero da carga nao informado.' };
  }

  // Buscar total de volumes
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
    return { sucesso: false, mensagem: 'Carga nao encontrada.' };
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
