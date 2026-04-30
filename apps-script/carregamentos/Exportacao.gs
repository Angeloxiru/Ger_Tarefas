/**
 * Adiciona menu de exportacao para gerar planilha de carregamentos.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Exportação')
    .addItem('Gerar exportação de carregamentos', 'gerarExportacaoCarregamentos')
    .addToUi();
}
 
/**
 * Gera arquivo carregamento_N com dados de carregamento/limpeza.
 */
function gerarExportacaoCarregamentos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var abaRegistros = ss.getSheetByName('Registros');
  var abaCargas = ss.getSheetByName('Cargas');
  var abaFuncionarios = ss.getSheetByName('Funcionarios');
 
  if (!abaRegistros || !abaCargas || !abaFuncionarios) {
    throw new Error('Abas obrigatórias não encontradas: Registros, Cargas e Funcionarios.');
  }
 
  var mapaFuncionarios = buildFuncionariosMap_(abaFuncionarios);
  var mapaItensPorRegistro = buildItensMap_(abaCargas);
  var linhasExportacao = buildLinhasExportacao_(abaRegistros, mapaItensPorRegistro, mapaFuncionarios);
 
  var nomeArquivo = getNextCarregamentoFileName_();
  var novoArquivo = SpreadsheetApp.create(nomeArquivo);
  var abaExportacao = novoArquivo.getSheets()[0];
  abaExportacao.setName('Exportação');
 
  var cabecalho = [
    'Tarefas Diárias',
    'Qtd de Tarefas',
    'Qtd Itens',
    'Soma de Tempo',
    'Volume por hora',
    'Nome do funcionário',
    'Data'
  ];
 
  abaExportacao.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
 
  if (linhasExportacao.length > 0) {
    abaExportacao.getRange(2, 1, linhasExportacao.length, cabecalho.length).setValues(linhasExportacao);
  }
 
  abaExportacao.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold').setBackground('#d9e1f2');
  abaExportacao.getRange(2, 4, Math.max(linhasExportacao.length, 1), 1).setNumberFormat('[hh]:mm:ss');
  abaExportacao.autoResizeColumns(1, cabecalho.length);
 
  Logger.log('Arquivo criado: ' + novoArquivo.getUrl());
  SpreadsheetApp.getUi().alert('Exportação criada com sucesso: ' + nomeArquivo);
}
 
function buildFuncionariosMap_(abaFuncionarios) {
  var dados = abaFuncionarios.getDataRange().getValues();
  if (dados.length < 2) return {};
 
  var header = dados[0].map(normalizarCampo_);
  var idxCodigo = header.indexOf('codigo');
  var idxNomeCompleto = header.indexOf('nome_completo');
  if (idxCodigo < 0 || idxNomeCompleto < 0) {
    throw new Error('A aba Funcionarios precisa ter as colunas codigo e nome_completo.');
  }
 
  var mapa = {};
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var codigo = String(linha[idxCodigo] || '').trim();
    if (!codigo) continue;
 
    var nomeCompleto = String(linha[idxNomeCompleto] || '').trim();
    mapa[codigo] = nomeCompleto || codigo;
  }
  return mapa;
}
 
function buildItensMap_(abaCargas) {
  var dados = abaCargas.getDataRange().getValues();
  if (dados.length < 2) return {};
 
  var header = dados[0].map(normalizarCampo_);
  var idxRegistro = header.indexOf('id_registro');
  var idxVolumes = header.indexOf('qtd_volumes');
 
  var mapa = {};
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var registro = String(linha[idxRegistro] || '').trim();
    if (!registro) continue;
    mapa[registro] = Number(linha[idxVolumes] || 0);
  }
  return mapa;
}
 
function buildLinhasExportacao_(abaRegistros, mapaItensPorRegistro, mapaFuncionarios) {
  var dados = abaRegistros.getDataRange().getValues();
  if (dados.length < 2) return [];
 
  var header = dados[0].map(normalizarCampo_);
  var idxCodigo = header.indexOf('codigo_func');
  var idxNomeTarefa = header.indexOf('nome_tarefa');
  var idxInicio = header.indexOf('data_inicio');
  var idxFim = header.indexOf('data_fim');
  var idxStatus = header.indexOf('status');
  var idxRegistro = header.indexOf('id_registro');
 
  var linhas = [];
 
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var status = String(linha[idxStatus] || '').toLowerCase();
    if (status !== 'finalizada') continue;
 
    var tarefa = String(linha[idxNomeTarefa] || '').trim();
    var tarefaLower = normalizarCampo_(tarefa);
    if (!tarefaLower) continue;
 
    var inicio = linha[idxInicio];
    var fim = linha[idxFim];
    if (!(inicio instanceof Date) || !(fim instanceof Date)) continue;
 
    var diffMs = fim.getTime() - inicio.getTime();
    if (diffMs < 0) continue;
 
    var codigo = String(linha[idxCodigo] || '').trim();
    var idRegistro = String(linha[idxRegistro] || '').trim();
    var qtdItens = isTarefaCarregamento_(tarefaLower) ? (mapaItensPorRegistro[idRegistro] || 0) : 0;
 
    linhas.push([
      tarefa,
      1,
      qtdItens,
      diffMs / (1000 * 60 * 60 * 24),
      0,
      mapaFuncionarios[codigo] || codigo,
      formatarDataBrasileira_(inicio)
    ]);
  }
 
  return linhas;
}
 
function getNextCarregamentoFileName_() {
  var arquivos = DriveApp.getFilesByType(MimeType.GOOGLE_SHEETS);
  var maxSequencial = 0;
  var regex = /^carregamento_(\d+)$/i;
 
  while (arquivos.hasNext()) {
    var nome = arquivos.next().getName();
    var match = nome.match(regex);
    if (!match) continue;
    var numero = Number(match[1]);
    if (numero > maxSequencial) maxSequencial = numero;
  }
 
  return 'carregamento_' + (maxSequencial + 1);
}
 
function normalizarCampo_(valor) {
  return String(valor || '').trim().toLowerCase();
}
 
function formatarDataBrasileira_(data) {
  var meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var dia = data.getDate();
  var diaFormatado = dia < 10 ? '0' + dia : String(dia);
  return diaFormatado + '/' + meses[data.getMonth()];
}
 
function isTarefaCarregamento_(nomeTarefaNormalizado) {
  return nomeTarefaNormalizado.indexOf('carregamento') !== -1;
}
 
