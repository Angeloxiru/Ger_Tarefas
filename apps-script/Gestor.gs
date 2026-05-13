// Gestor.gs - Funcoes do painel do gestor

// Painel em tempo real
function Gestor_painel(params) {
  // Funcionarios via cache (mudam raramente)
  var dadosFunc = getSheetDataCached('Funcionarios', 600);
  var headersFunc = dadosFunc[0];

  var idxCodigo = headersFunc.indexOf('codigo');
  var idxNome = headersFunc.indexOf('nome');
  var idxCargo = headersFunc.indexOf('cargo');
  var idxAtivo = headersFunc.indexOf('ativo');
  var idxPerfil = headersFunc.indexOf('perfil');

  // Registros e Cargas sempre frescos (mudam constantemente)
  var sheetReg = getSheet('Registros');
  var dadosReg = sheetReg.getDataRange().getValues();
  var headersReg = dadosReg[0];

  var idxRegId = headersReg.indexOf('id_registro');
  var idxRegCodFunc = headersReg.indexOf('codigo_func');
  var idxRegIdTarefa = headersReg.indexOf('id_tarefa');
  var idxRegNomeTarefa = headersReg.indexOf('nome_tarefa');
  var idxRegDataInicio = headersReg.indexOf('data_inicio');
  var idxRegStatus = headersReg.indexOf('status');

  // Mapear registros em andamento por funcionario
  var registrosAtivos = {};
  for (var r = 1; r < dadosReg.length; r++) {
    if (dadosReg[r][idxRegStatus] === 'em_andamento') {
      var codFunc = String(dadosReg[r][idxRegCodFunc]).trim().toUpperCase();
      registrosAtivos[codFunc] = {
        id_registro: dadosReg[r][idxRegId],
        id_tarefa: dadosReg[r][idxRegIdTarefa],
        nome_tarefa: dadosReg[r][idxRegNomeTarefa],
        data_inicio: formatarData(dadosReg[r][idxRegDataInicio])
      };
    }
  }

  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];
  var idxCargaIdReg = headersCargas.indexOf('id_registro');
  var idxCargaNumero = headersCargas.indexOf('numero_carga');
  var idxCargaVolumes = headersCargas.indexOf('qtd_volumes');
  var idxCargaDoca2 = headersCargas.indexOf('doca');

  var cargasPorRegistro = {};
  var workersPorCarga = {};
  for (var c = 1; c < dadosCargas.length; c++) {
    var idRegCarga = dadosCargas[c][idxCargaIdReg];
    var numCarga = dadosCargas[c][idxCargaNumero];
    cargasPorRegistro[idRegCarga] = {
      numero_carga: numCarga,
      qtd_volumes: dadosCargas[c][idxCargaVolumes],
      doca: idxCargaDoca2 >= 0 ? dadosCargas[c][idxCargaDoca2] : ''
    };
    workersPorCarga[numCarga] = (workersPorCarga[numCarga] || 0) + 1;
  }

  var funcionarios = [];
  var totalAtivos = 0;
  var totalOciosos = 0;
  var totalAlertas = 0;
  var agora = new Date().getTime();

  for (var i = 1; i < dadosFunc.length; i++) {
    var row = dadosFunc[i];
    if (!row[idxAtivo]) continue;

    var codigo = String(row[idxCodigo]).trim().toUpperCase();
    var func = {
      codigo: row[idxCodigo],
      nome: row[idxNome],
      cargo: row[idxCargo],
      perfil: row[idxPerfil],
      tarefa_atual: null
    };

    if (registrosAtivos[codigo]) {
      var reg = registrosAtivos[codigo];
      func.tarefa_atual = reg;

      if (cargasPorRegistro[reg.id_registro]) {
        var carga = cargasPorRegistro[reg.id_registro];
        func.tarefa_atual.carga = {
          numero_carga: carga.numero_carga,
          qtd_volumes: carga.qtd_volumes,
          nome_doca: buscarNomeDoca(carga.doca),
          total_workers: workersPorCarga[carga.numero_carga] || 1
        };
      }

      totalAtivos++;

      var inicio = new Date(reg.data_inicio).getTime();
      if ((agora - inicio) >= 10800000) {
        totalAlertas++;
      }
    } else {
      totalOciosos++;
    }

    if (params && params.filtro_status) {
      var filtroStatus = params.filtro_status;
      if (filtroStatus === 'ocioso' && func.tarefa_atual) continue;
      if (filtroStatus === 'em_andamento' && !func.tarefa_atual) continue;
      if (filtroStatus === 'alerta' && func.tarefa_atual) {
        var inicioAlerta = new Date(func.tarefa_atual.data_inicio).getTime();
        if ((agora - inicioAlerta) < 10800000) continue;
      }
      if (filtroStatus === 'alerta' && !func.tarefa_atual) continue;
    }

    if (params && params.filtro_tarefa && func.tarefa_atual) {
      if (func.tarefa_atual.id_tarefa !== params.filtro_tarefa) continue;
    }
    if (params && params.filtro_tarefa && !func.tarefa_atual) continue;

    funcionarios.push(func);
  }

  // Tarefas via cache
  var tarefas = Tarefas_listar().dados || [];

  var totalFunc = 0;
  for (var t = 1; t < dadosFunc.length; t++) {
    if (dadosFunc[t][idxAtivo]) totalFunc++;
  }

  return {
    sucesso: true,
    dados: {
      total: totalFunc,
      ativos: totalAtivos,
      ociosos: totalOciosos,
      alertas: totalAlertas,
      funcionarios: funcionarios,
      tarefas: tarefas
    }
  };
}

// Historico de registros
function Gestor_historico(params) {
  var sheetReg = getSheet('Registros');
  var dados = sheetReg.getDataRange().getValues();
  var headers = dados[0];

  var idxId            = headers.indexOf('id_registro');
  var idxCodFunc       = headers.indexOf('codigo_func');
  var idxIdTarefa      = headers.indexOf('id_tarefa');
  var idxNomeTarefa    = headers.indexOf('nome_tarefa');
  var idxDataInicio    = headers.indexOf('data_inicio');
  var idxDataFim       = headers.indexOf('data_fim');
  var idxStatus        = headers.indexOf('status');
  var idxFinalizadoPor = headers.indexOf('finalizado_por');
  // Coluna gravada na finalizacao — evita recalculo inconsistente no historico
  var idxVolSalvo      = headers.indexOf('volumes_proporcionais');

  var dataInicio = params.data_inicio ? new Date(params.data_inicio) : null;
  var dataFim = params.data_fim ? new Date(params.data_fim + 'T23:59:59') : null;

  var filtroFuncionarios = null;
  if (params.funcionarios && params.funcionarios.trim() !== '') {
    filtroFuncionarios = params.funcionarios.split(',').map(function(f) {
      return f.trim().toUpperCase();
    });
  }

  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];
  var idxCargaIdReg = headersCargas.indexOf('id_registro');
  var idxCargaNumero = headersCargas.indexOf('numero_carga');
  var idxCargaVolumes = headersCargas.indexOf('qtd_volumes');
  var idxCargaDoca = headersCargas.indexOf('doca');

  var cargasPorRegistro = {};
  for (var c = 1; c < dadosCargas.length; c++) {
    cargasPorRegistro[dadosCargas[c][idxCargaIdReg]] = {
      numero_carga: dadosCargas[c][idxCargaNumero],
      qtd_volumes: dadosCargas[c][idxCargaVolumes],
      doca: idxCargaDoca >= 0 ? dadosCargas[c][idxCargaDoca] : ''
    };
  }

  // Nomes via cache
  var mapaNomes = buscarMapaNomes();

  var cacheDocas = {};
  // cacheDist usado apenas como fallback para registros antigos sem coluna gravada
  var cacheDist = {};

  var registros = [];
  for (var i = dados.length - 1; i >= 1; i--) {
    var row = dados[i];

    if (filtroFuncionarios) {
      var codFuncReg = String(row[idxCodFunc]).trim().toUpperCase();
      if (filtroFuncionarios.indexOf(codFuncReg) === -1) continue;
    }

    if (dataInicio || dataFim) {
      var dataReg = new Date(row[idxDataInicio]);
      if (dataInicio && dataReg < dataInicio) continue;
      if (dataFim && dataReg > dataFim) continue;
    }

    var codFuncUpper = String(row[idxCodFunc]).trim().toUpperCase();

    // Ler volumes gravados na finalizacao (coluna pode nao existir em dados antigos)
    var volSalvo = null;
    if (idxVolSalvo >= 0 && row[idxVolSalvo] !== '' && row[idxVolSalvo] !== null && row[idxVolSalvo] !== undefined) {
      volSalvo = Number(row[idxVolSalvo]);
    }

    var registro = {
      id_registro: row[idxId],
      codigo_func: row[idxCodFunc],
      nome_func: mapaNomes[codFuncUpper] || row[idxCodFunc],
      nome_tarefa: row[idxNomeTarefa],
      data_inicio: formatarData(row[idxDataInicio]),
      data_fim: row[idxDataFim] ? formatarData(row[idxDataFim]) : null,
      status: row[idxStatus],
      finalizado_por: row[idxFinalizadoPor],
      numero_carga: null,
      qtd_volumes: null,
      volumes_proporcionais: volSalvo,
      nome_doca: null
    };

    if (cargasPorRegistro[row[idxId]]) {
      var carga = cargasPorRegistro[row[idxId]];
      registro.numero_carga = carga.numero_carga;
      registro.qtd_volumes = carga.qtd_volumes;

      if (carga.doca) {
        if (cacheDocas[carga.doca] === undefined) {
          cacheDocas[carga.doca] = buscarNomeDoca(carga.doca);
        }
        registro.nome_doca = cacheDocas[carga.doca];
      }

      // Fallback: recalcular apenas se o valor nao foi gravado (dados anteriores a esta versao)
      if (volSalvo === null && (registro.status === 'finalizada' || registro.status === 'timeout')) {
        var chaveCache = carga.numero_carga + '|' + carga.qtd_volumes;
        if (cacheDist[chaveCache] === undefined) {
          cacheDist[chaveCache] = calcularDistribuicaoVolumes(carga.numero_carga, carga.qtd_volumes);
        }
        var dist = cacheDist[chaveCache];
        for (var d = 0; d < dist.length; d++) {
          if (String(dist[d].codigo_func).trim().toUpperCase() === codFuncUpper) {
            registro.volumes_proporcionais = dist[d].volumes_proporcionais;
            break;
          }
        }
      }
    }

    registros.push(registro);

    if (registros.length >= 200) break;
  }

  return { sucesso: true, dados: registros };
}

// Cadastrar novo funcionario
function Gestor_cadastrarFuncionario(dados) {
  if (!dados.codigo || !dados.nome || !dados.cargo || !dados.senha) {
    return { sucesso: false, mensagem: 'Preencha todos os campos obrigatórios, incluindo a senha.' };
  }

  var codigo = dados.codigo.trim().toUpperCase();

  var sheet = getSheet('Funcionarios');
  var existentes = sheet.getDataRange().getValues();
  var headers = existentes[0];
  var idxCodigo = headers.indexOf('codigo');

  for (var i = 1; i < existentes.length; i++) {
    if (String(existentes[i][idxCodigo]).trim().toUpperCase() === codigo) {
      return { sucesso: false, mensagem: 'Já existe um funcionário com este código.' };
    }
  }

  sheet.appendRow([
    codigo,
    dados.nome.trim(),
    dados.cargo.trim(),
    true,
    dados.perfil || 'funcionario',
    dados.senha.trim()
  ]);

  // Invalida cache para que o novo funcionario seja visivel imediatamente
  invalidarCache('Funcionarios');

  return { sucesso: true, mensagem: 'Funcionário cadastrado com sucesso.' };
}

// Registrar alerta para um funcionario
function Gestor_registrarAlerta(dados) {
  if (!dados.codigo_func || !dados.descricao) {
    return { sucesso: false, mensagem: 'Informe o funcionário e a descrição do alerta.' };
  }

  var codigoFunc = dados.codigo_func.trim().toUpperCase();

  var mapaNomes = buscarMapaNomes();
  if (!mapaNomes[codigoFunc]) {
    return { sucesso: false, mensagem: 'Funcionário não encontrado: ' + codigoFunc };
  }

  var codigoEmissor = dados.codigo_emissor ? dados.codigo_emissor.trim().toUpperCase() : '';

  var sheet = getSheet('Alertas');
  var agora = new Date();
  var idRegistro = 'A' + Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + codigoFunc;

  sheet.appendRow([
    idRegistro,
    codigoFunc,
    agora,
    dados.descricao.trim(),
    codigoEmissor
  ]);

  return {
    sucesso: true,
    dados: { id_registro: idRegistro, nome_func: mapaNomes[codigoFunc] },
    mensagem: 'Alerta registrado para ' + mapaNomes[codigoFunc] + '.'
  };
}

// Listar alertas (todos ou de um funcionario)
function Gestor_listarAlertas(codigoFunc) {
  var sheet = getSheet('Alertas');
  var dados = sheet.getDataRange().getValues();
  var headers = dados[0];

  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxData = headers.indexOf('data_alerta');
  var idxDesc = headers.indexOf('descricao');
  var idxEmissor = headers.indexOf('emissor');

  var mapaNomes = buscarMapaNomes();
  var filtro = codigoFunc ? codigoFunc.trim().toUpperCase() : null;

  var alertas = [];
  for (var i = dados.length - 1; i >= 1; i--) {
    var cod = String(dados[i][idxCodFunc]).trim().toUpperCase();
    if (filtro && cod !== filtro) continue;

    var codigEmissor = idxEmissor >= 0 ? String(dados[i][idxEmissor]).trim().toUpperCase() : '';
    alertas.push({
      id_registro: dados[i][idxId],
      codigo_func: dados[i][idxCodFunc],
      nome_func: mapaNomes[cod] || dados[i][idxCodFunc],
      data_alerta: formatarData(dados[i][idxData]),
      descricao: dados[i][idxDesc],
      emissor: codigEmissor ? (mapaNomes[codigEmissor] || codigEmissor) : ''
    });

    if (alertas.length >= 100) break;
  }

  return { sucesso: true, dados: alertas };
}

// Raio X - Resumo por periodo (equipe ou individual)
function Gestor_raiox(params) {
  var periodo = params.periodo || 'diario';
  var tipo    = params.tipo    || 'equipe';
  var codigoFuncParam = params.codigo_func ? params.codigo_func.trim().toUpperCase() : null;

  // Calcular intervalo de datas no fuso do script
  var tz = Session.getScriptTimeZone();
  var hojeStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-');
  var ano = parseInt(hojeStr[0], 10);
  var mes = parseInt(hojeStr[1], 10) - 1;
  var dia = parseInt(hojeStr[2], 10);

  var dataInicio, dataFim;
  if (periodo === 'diario') {
    dataInicio = new Date(ano, mes, dia, 0, 0, 0, 0);
    dataFim    = new Date(ano, mes, dia, 23, 59, 59, 999);
  } else if (periodo === 'semanal') {
    var diasDomingo = new Date(ano, mes, dia).getDay();
    dataInicio = new Date(ano, mes, dia - diasDomingo, 0, 0, 0, 0);
    dataFim    = new Date(ano, mes, dia + (6 - diasDomingo), 23, 59, 59, 999);
  } else {
    dataInicio = new Date(ano, mes, 1, 0, 0, 0, 0);
    dataFim    = new Date(ano, mes + 1, 0, 23, 59, 59, 999);
  }

  // Lista de funcionarios ativos (para seletor do Detalhado)
  if (tipo === 'funcionarios') {
    var dadosFunc = getSheetDataCached('Funcionarios', 600);
    var hFunc = dadosFunc[0];
    var ixCod  = hFunc.indexOf('codigo');
    var ixNome = hFunc.indexOf('nome');
    var ixAtiv = hFunc.indexOf('ativo');
    var funcionarios = [];
    for (var f = 1; f < dadosFunc.length; f++) {
      if (!dadosFunc[f][ixAtiv]) continue;
      funcionarios.push({
        codigo: String(dadosFunc[f][ixCod]).trim().toUpperCase(),
        nome: dadosFunc[f][ixNome]
      });
    }
    funcionarios.sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    return { sucesso: true, dados: { funcionarios: funcionarios } };
  }

  // Ler Registros frescos (sem cache)
  var sheetReg = getSheet('Registros');
  var dadosReg = sheetReg.getDataRange().getValues();
  var hReg = dadosReg[0];
  var ixId      = hReg.indexOf('id_registro');
  var ixCodFunc = hReg.indexOf('codigo_func');
  var ixIdTar   = hReg.indexOf('id_tarefa');
  var ixNomeTar = hReg.indexOf('nome_tarefa');
  var ixIni     = hReg.indexOf('data_inicio');
  var ixFimCol  = hReg.indexOf('data_fim');
  var ixStatus  = hReg.indexOf('status');
  var ixVol     = hReg.indexOf('volumes_proporcionais');

  var mapaNomes = buscarMapaNomes();

  var registros = [];
  for (var r = 1; r < dadosReg.length; r++) {
    var row = dadosReg[r];
    var status = row[ixStatus];
    if (status !== 'finalizada' && status !== 'timeout') continue;

    var dtIni = new Date(row[ixIni]);
    if (dtIni < dataInicio || dtIni > dataFim) continue;

    var codFunc = String(row[ixCodFunc]).trim().toUpperCase();
    if (codigoFuncParam && codFunc !== codigoFuncParam) continue;

    var dtFim = row[ixFimCol] ? new Date(row[ixFimCol]) : null;
    var tempoMs = dtFim ? Math.max(dtFim.getTime() - dtIni.getTime(), 0) : 0;

    var vol = null;
    if (ixVol >= 0 && row[ixVol] !== '' && row[ixVol] !== null && row[ixVol] !== undefined) {
      vol = Number(row[ixVol]);
    }

    registros.push({
      codigo_func: codFunc,
      nome_func:   mapaNomes[codFunc] || row[ixCodFunc],
      id_tarefa:   row[ixIdTar],
      nome_tarefa: row[ixNomeTar],
      tempo_ms:    tempoMs,
      volumes:     vol
    });
  }

  // --- RESUMO EQUIPE ---
  if (tipo === 'equipe') {
    var mapaTarefas = {};
    for (var i = 0; i < registros.length; i++) {
      var reg = registros[i];
      var tid = reg.id_tarefa;
      if (!mapaTarefas[tid]) {
        mapaTarefas[tid] = { id_tarefa: tid, nome_tarefa: reg.nome_tarefa, workers: {}, tem_volumes: false };
      }
      var cf = reg.codigo_func;
      if (!mapaTarefas[tid].workers[cf]) {
        mapaTarefas[tid].workers[cf] = {
          codigo_func: cf, nome_func: reg.nome_func,
          tempo_ms: 0, volumes: 0, tem_volumes: false
        };
      }
      mapaTarefas[tid].workers[cf].tempo_ms += reg.tempo_ms;
      if (reg.volumes !== null) {
        mapaTarefas[tid].workers[cf].volumes += reg.volumes;
        mapaTarefas[tid].workers[cf].tem_volumes = true;
        mapaTarefas[tid].tem_volumes = true;
      }
    }

    var tarefas = [];
    for (var tid2 in mapaTarefas) {
      var tarefa = mapaTarefas[tid2];
      var workersArr = [];
      for (var wcf in tarefa.workers) { workersArr.push(tarefa.workers[wcf]); }
      workersArr.sort(function(a, b) { return a.tempo_ms - b.tempo_ms; });
      tarefas.push({
        id_tarefa: tarefa.id_tarefa, nome_tarefa: tarefa.nome_tarefa,
        tem_volumes: tarefa.tem_volumes, workers: workersArr
      });
    }
    tarefas.sort(function(a, b) { return a.nome_tarefa.localeCompare(b.nome_tarefa, 'pt-BR'); });

    return { sucesso: true, dados: { tipo: 'equipe', periodo: periodo, tarefas: tarefas } };
  }

  // --- DETALHADO INDIVIDUAL ---
  if (tipo === 'individual') {
    if (!codigoFuncParam) {
      return { sucesso: false, mensagem: 'Código do funcionário não informado.' };
    }

    var mapaT = {};
    for (var j = 0; j < registros.length; j++) {
      var regJ = registros[j];
      var tidJ = regJ.id_tarefa;
      if (!mapaT[tidJ]) {
        mapaT[tidJ] = { id_tarefa: tidJ, nome_tarefa: regJ.nome_tarefa, tempo_ms: 0, volumes: 0, tem_volumes: false };
      }
      mapaT[tidJ].tempo_ms += regJ.tempo_ms;
      if (regJ.volumes !== null) {
        mapaT[tidJ].volumes += regJ.volumes;
        mapaT[tidJ].tem_volumes = true;
      }
    }

    var tarefasFunc = [];
    for (var tid3 in mapaT) { tarefasFunc.push(mapaT[tid3]); }
    tarefasFunc.sort(function(a, b) { return b.tempo_ms - a.tempo_ms; });

    // Contar alertas no periodo
    var sheetAlertas = getSheet('Alertas');
    var dadosAlertas = sheetAlertas.getDataRange().getValues();
    var hAlertas = dadosAlertas[0];
    var ixACod  = hAlertas.indexOf('codigo_func');
    var ixAData = hAlertas.indexOf('data_alerta');
    var totalAlertas = 0;
    for (var a = 1; a < dadosAlertas.length; a++) {
      if (String(dadosAlertas[a][ixACod]).trim().toUpperCase() !== codigoFuncParam) continue;
      var dtAlerta = new Date(dadosAlertas[a][ixAData]);
      if (dtAlerta >= dataInicio && dtAlerta <= dataFim) totalAlertas++;
    }

    return {
      sucesso: true,
      dados: {
        tipo: 'individual', periodo: periodo,
        funcionario: { codigo: codigoFuncParam, nome: mapaNomes[codigoFuncParam] || codigoFuncParam },
        tarefas: tarefasFunc,
        total_alertas: totalAlertas
      }
    };
  }

  return { sucesso: false, mensagem: 'Tipo inválido.' };
}

// Cadastrar nova tarefa
function Gestor_cadastrarTarefa(dados) {
  if (!dados.nome) {
    return { sucesso: false, mensagem: 'Informe o nome da tarefa.' };
  }

  var sheet = getSheet('Tarefas');
  var existentes = sheet.getDataRange().getValues();

  var ultimoId = 0;
  var headers = existentes[0];
  var idxId = headers.indexOf('id_tarefa');

  for (var i = 1; i < existentes.length; i++) {
    var id = String(existentes[i][idxId]);
    var num = parseInt(id.replace('T', ''), 10);
    if (num > ultimoId) ultimoId = num;
  }

  var novoId = 'T' + String(ultimoId + 1).padStart(3, '0');

  sheet.appendRow([
    novoId,
    dados.nome.trim(),
    dados.usa_qrcode_carga || false,
    dados.tempo_maximo_min || 240,
    true
  ]);

  // Invalida cache para que a nova tarefa seja visivel imediatamente
  invalidarCache('Tarefas');

  return {
    sucesso: true,
    dados: { id_tarefa: novoId },
    mensagem: 'Tarefa cadastrada com sucesso.'
  };
}
