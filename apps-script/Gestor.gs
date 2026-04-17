// Gestor.gs - Funcoes do painel do gestor

// Painel em tempo real
function Gestor_painel(params) {
  var sheetFunc = getSheet('Funcionarios');
  var dadosFunc = sheetFunc.getDataRange().getValues();
  var headersFunc = dadosFunc[0];

  var idxCodigo = headersFunc.indexOf('codigo');
  var idxNome = headersFunc.indexOf('nome');
  var idxCargo = headersFunc.indexOf('cargo');
  var idxAtivo = headersFunc.indexOf('ativo');
  var idxPerfil = headersFunc.indexOf('perfil');

  // Buscar todos os registros em andamento
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

  // Buscar dados de cargas para registros ativos
  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];
  var idxCargaIdReg = headersCargas.indexOf('id_registro');
  var idxCargaNumero = headersCargas.indexOf('numero_carga');
  var idxCargaVolumes = headersCargas.indexOf('qtd_volumes');

  var cargasPorRegistro = {};
  for (var c = 1; c < dadosCargas.length; c++) {
    cargasPorRegistro[dadosCargas[c][idxCargaIdReg]] = {
      numero_carga: dadosCargas[c][idxCargaNumero],
      qtd_volumes: dadosCargas[c][idxCargaVolumes]
    };
  }

  // Contar workers por carga
  var workersPorCarga = {};
  for (var c2 = 1; c2 < dadosCargas.length; c2++) {
    var numCarga = dadosCargas[c2][idxCargaNumero];
    workersPorCarga[numCarga] = (workersPorCarga[numCarga] || 0) + 1;
  }

  // Montar lista de funcionarios
  var funcionarios = [];
  var totalAtivos = 0;
  var totalOciosos = 0;
  var totalAlertas = 0;
  var agora = new Date().getTime();

  for (var i = 1; i < dadosFunc.length; i++) {
    var row = dadosFunc[i];
    if (!row[idxAtivo]) continue; // Ignorar inativos

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

      // Verificar se tem carga
      if (cargasPorRegistro[reg.id_registro]) {
        var carga = cargasPorRegistro[reg.id_registro];
        func.tarefa_atual.carga = {
          numero_carga: carga.numero_carga,
          qtd_volumes: carga.qtd_volumes,
          total_workers: workersPorCarga[carga.numero_carga] || 1
        };
      }

      totalAtivos++;

      // Verificar se esta em alerta
      var inicio = new Date(reg.data_inicio).getTime();
      if ((agora - inicio) >= 10800000) { // 3 horas em ms
        totalAlertas++;
      }
    } else {
      totalOciosos++;
    }

    // Aplicar filtros
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

  // Buscar lista de tarefas para filtro
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

  var idxId = headers.indexOf('id_registro');
  var idxCodFunc = headers.indexOf('codigo_func');
  var idxIdTarefa = headers.indexOf('id_tarefa');
  var idxNomeTarefa = headers.indexOf('nome_tarefa');
  var idxDataInicio = headers.indexOf('data_inicio');
  var idxDataFim = headers.indexOf('data_fim');
  var idxStatus = headers.indexOf('status');
  var idxFinalizadoPor = headers.indexOf('finalizado_por');

  var dataInicio = params.data_inicio ? new Date(params.data_inicio) : null;
  var dataFim = params.data_fim ? new Date(params.data_fim + 'T23:59:59') : null;

  // Filtro de funcionarios (lista separada por virgula)
  var filtroFuncionarios = null;
  if (params.funcionarios && params.funcionarios.trim() !== '') {
    filtroFuncionarios = params.funcionarios.split(',').map(function(f) {
      return f.trim().toUpperCase();
    });
  }

  // Buscar cargas para enriquecer dados
  var sheetCargas = getSheet('Cargas');
  var dadosCargas = sheetCargas.getDataRange().getValues();
  var headersCargas = dadosCargas[0];
  var idxCargaIdReg = headersCargas.indexOf('id_registro');
  var idxCargaNumero = headersCargas.indexOf('numero_carga');
  var idxCargaVolumes = headersCargas.indexOf('qtd_volumes');

  var cargasPorRegistro = {};
  for (var c = 1; c < dadosCargas.length; c++) {
    cargasPorRegistro[dadosCargas[c][idxCargaIdReg]] = {
      numero_carga: dadosCargas[c][idxCargaNumero],
      qtd_volumes: dadosCargas[c][idxCargaVolumes]
    };
  }

  var registros = [];
  for (var i = dados.length - 1; i >= 1; i--) {
    var row = dados[i];

    // Filtrar por funcionarios
    if (filtroFuncionarios) {
      var codFuncReg = String(row[idxCodFunc]).trim().toUpperCase();
      if (filtroFuncionarios.indexOf(codFuncReg) === -1) continue;
    }

    // Filtrar por data
    if (dataInicio || dataFim) {
      var dataReg = new Date(row[idxDataInicio]);
      if (dataInicio && dataReg < dataInicio) continue;
      if (dataFim && dataReg > dataFim) continue;
    }

    var registro = {
      id_registro: row[idxId],
      codigo_func: row[idxCodFunc],
      nome_tarefa: row[idxNomeTarefa],
      data_inicio: formatarData(row[idxDataInicio]),
      data_fim: row[idxDataFim] ? formatarData(row[idxDataFim]) : null,
      status: row[idxStatus],
      finalizado_por: row[idxFinalizadoPor],
      numero_carga: null,
      qtd_volumes: null,
      volumes_proporcionais: null
    };

    // Enriquecer com dados de carga
    if (cargasPorRegistro[row[idxId]]) {
      var carga = cargasPorRegistro[row[idxId]];
      registro.numero_carga = carga.numero_carga;
      registro.qtd_volumes = carga.qtd_volumes;

      // Calcular volumes proporcionais se finalizada
      if (registro.status === 'finalizada' || registro.status === 'timeout') {
        var dist = calcularDistribuicaoVolumes(carga.numero_carga, carga.qtd_volumes);
        for (var d = 0; d < dist.length; d++) {
          if (dist[d].codigo_func === row[idxCodFunc]) {
            registro.volumes_proporcionais = dist[d].volumes_proporcionais;
            break;
          }
        }
      }
    }

    registros.push(registro);

    // Limitar a 200 registros
    if (registros.length >= 200) break;
  }

  return { sucesso: true, dados: registros };
}

// Cadastrar novo funcionario
function Gestor_cadastrarFuncionario(dados) {
  if (!dados.codigo || !dados.nome || !dados.cargo || !dados.senha) {
    return { sucesso: false, mensagem: 'Preencha todos os campos obrigatorios, incluindo a senha.' };
  }

  var codigo = dados.codigo.trim().toUpperCase();

  // Verificar se ja existe
  var sheet = getSheet('Funcionarios');
  var existentes = sheet.getDataRange().getValues();
  var headers = existentes[0];
  var idxCodigo = headers.indexOf('codigo');

  for (var i = 1; i < existentes.length; i++) {
    if (String(existentes[i][idxCodigo]).trim().toUpperCase() === codigo) {
      return { sucesso: false, mensagem: 'Ja existe um funcionario com este codigo.' };
    }
  }

  sheet.appendRow([
    codigo,
    dados.nome.trim(),
    dados.cargo.trim(),
    true, // ativo
    dados.perfil || 'funcionario',
    dados.senha.trim()
  ]);

  return { sucesso: true, mensagem: 'Funcionario cadastrado com sucesso.' };
}

// Cadastrar nova tarefa
function Gestor_cadastrarTarefa(dados) {
  if (!dados.nome) {
    return { sucesso: false, mensagem: 'Informe o nome da tarefa.' };
  }

  var sheet = getSheet('Tarefas');
  var existentes = sheet.getDataRange().getValues();

  // Gerar ID da tarefa
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
    true // ativa
  ]);

  return {
    sucesso: true,
    dados: { id_tarefa: novoId },
    mensagem: 'Tarefa cadastrada com sucesso.'
  };
}
