// Code.gs - Roteador principal (doGet / doPost)
// Este arquivo deve ser copiado para o Google Apps Script

// ID da planilha Google Sheets
var SPREADSHEET_ID = '1sChUfWfpYeSM8povUqwQQT0WbsxVyniMlZSa7AOdb5Y';

function doGet(e) {
  var acao = e.parameter.acao;

  try {
    switch (acao) {
      case 'login':
        return responder(Auth_login(e.parameter.codigo));

      case 'listar_tarefas':
        return responder(Tarefas_listar());

      case 'status_funcionario':
        return responder(Tarefas_statusFuncionario(e.parameter.codigo));

      case 'painel_gestor':
        return responder(Gestor_painel(e.parameter));

      case 'historico':
        return responder(Gestor_historico(e.parameter));

      case 'workers_carga':
        return responder(Carregamento_workersCarga(e.parameter.numero_carga));

      case 'distribuicao_carga':
        return responder(Carregamento_distribuicao(e.parameter.numero_carga));

      default:
        return responder({ sucesso: false, mensagem: 'Acao GET desconhecida: ' + acao });
    }
  } catch (erro) {
    return responder({ sucesso: false, mensagem: 'Erro interno: ' + erro.message });
  }
}

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    var acao = dados.acao;

    switch (acao) {
      case 'iniciar_tarefa':
        return responder(Tarefas_iniciar(dados.codigo_func, dados.id_tarefa));

      case 'finalizar_tarefa':
        return responder(Tarefas_finalizar(dados.codigo_func, dados.id_registro));

      case 'registrar_carga':
        return responder(Carregamento_registrar(dados));

      case 'cadastrar_funcionario':
        return responder(Gestor_cadastrarFuncionario(dados));

      case 'cadastrar_tarefa':
        return responder(Gestor_cadastrarTarefa(dados));

      default:
        return responder({ sucesso: false, mensagem: 'Acao POST desconhecida: ' + acao });
    }
  } catch (erro) {
    return responder({ sucesso: false, mensagem: 'Erro interno: ' + erro.message });
  }
}

// Funcao auxiliar para retornar resposta JSON com CORS
function responder(dados) {
  return ContentService
    .createTextOutput(JSON.stringify(dados))
    .setMimeType(ContentService.MimeType.JSON);
}
