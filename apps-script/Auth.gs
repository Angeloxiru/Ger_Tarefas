// Auth.gs - Funcoes de autenticacao

function Auth_login(codigo, senha) {
  if (!codigo) {
    return { sucesso: false, mensagem: 'Codigo do cracha nao informado.' };
  }

  if (!senha) {
    return { sucesso: false, mensagem: 'Senha nao informada.' };
  }

  codigo = codigo.trim().toUpperCase();

  var sheet = getSheet('Funcionarios');
  var dados = sheet.getDataRange().getValues();
  var headers = dados[0];

  var idxCodigo = headers.indexOf('codigo');
  var idxNome = headers.indexOf('nome');
  var idxCargo = headers.indexOf('cargo');
  var idxAtivo = headers.indexOf('ativo');
  var idxPerfil = headers.indexOf('perfil');
  var idxSenha = headers.indexOf('senha');

  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (String(row[idxCodigo]).trim().toUpperCase() === codigo) {
      if (!row[idxAtivo]) {
        return { sucesso: false, mensagem: 'Funcionario inativo. Procure o supervisor.' };
      }

      // Verificar senha
      var senhaArmazenada = String(row[idxSenha]).trim();
      if (senhaArmazenada !== senha.trim()) {
        return { sucesso: false, mensagem: 'Senha incorreta.' };
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
