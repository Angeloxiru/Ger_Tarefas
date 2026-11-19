// api.js - Ponte entre as telas e as regras do sistema (js/backend.js)
//
// As telas continuam chamando API.get({ acao: '...', ... }) como antes, mas agora
// cada acao roda direto no banco Turso, sem passar pelo Google Apps Script.
// Tentativas automaticas e o aviso "tentando novamente" ficam no js/db.js.

DB.configurar(CONFIG.TURSO_URL, CONFIG.TURSO_TOKEN);
DB.timeoutMs = CONFIG.REQUEST_TIMEOUT;
DB.tentativas = CONFIG.MAX_TENTATIVAS;

const API = {
  async get(params) {
    return await Backend.executar(params);
  },

  // Mantido por compatibilidade: o login usava timeout menor
  async getComTimeout(params) {
    return await Backend.executar(params);
  },

  async post(dados) {
    return await Backend.executar(dados);
  },

  // Toast de feedback durante nova tentativa (criado dinamicamente)
  _mostrarToast(msg) {
    let toast = document.getElementById('api-retry-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'api-retry-toast';
      toast.className = 'api-retry-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visivel');
  },

  _esconderToast() {
    const toast = document.getElementById('api-retry-toast');
    if (toast) toast.classList.remove('visivel');
  }
};

DB.aoTentarNovamente = (t, max) => API._mostrarToast(`Sem resposta, tentando novamente (${t}/${max})...`);
DB.aoConcluir = () => API._esconderToast();
