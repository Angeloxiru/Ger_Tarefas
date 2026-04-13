// Auth.gs - Funcoes de autenticacao

function Auth_login(codigo) {
  if (!codigo) {
    return { sucesso: false, mensagem: 'Codigo do cracha nao informado.' };
  }

  codigo = codigo.trim().toUpperCase();

  var sheet = getSheet('Funcionarios');
  var dados = sheet.getDataRange().getValues();
  var headers = dados[0];

  // Encontrar indices das colunas
  var idxCodigo = headers.indexOf('codigo');
  var idxNome = headers.indexOf('nome');
  var idxCargo = headers.indexOf('cargo');
  var idxAtivo = headers.indexOf('ativo');
  var idxPerfil = headers.indexOf('perfil');

  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (String(row[idxCodigo]).trim().toUpperCase() === codigo) {
      // Verificar se esta ativo
      if (!row[idxAtivo]) {
        return { sucesso: false, mensagem: 'Funcionario inativo. Procure o supervisor.' };
      }

      return {
        sucesso: true,
        dados: {
          codigo: String(row[idxCodigo]).trim(),
          nome: row[idxNome],
          cargo: row[idxCargo],
          perfil: row[idxPerfil] || 'funcionario'
        },
        mensagem: 'Login realizado com sucesso.'
      };
    }
  }

  return { sucesso: false, mensagem: 'Cracha nao encontrado. Verifique o codigo.' };
}
