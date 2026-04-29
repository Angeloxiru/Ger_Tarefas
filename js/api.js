// api.js - Camada de comunicacao com Google Apps Script
// Resolve CORS usando redirect: 'follow' e mode adequado

const API = {
  // GET request para o Google Apps Script
  async get(params) {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const url = `${CONFIG.API_URL}?${query}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexão esgotado. Verifique sua rede.' };
      }
      // Tentar via JSONP como fallback (CORS bloqueado)
      return await this.getFallback(url);
    }
  },

  // POST request para o Google Apps Script
  async post(dados) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(CONFIG.API_URL, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(dados)
      });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexão esgotado. Verifique sua rede.' };
      }
      // Tentar POST via GET como fallback (CORS bloqueado)
      return await this.postFallback(dados);
    }
  },

  // Fallback GET: usa google.script.run via iframe nao funciona,
  // entao usamos fetch com mode no-cors + script injection
  async getFallback(url) {
    return new Promise((resolve) => {
      const callbackName = '_cb_' + Date.now();
      const timeout = setTimeout(() => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve({ sucesso: false, mensagem: 'Tempo de conexão esgotado. Verifique sua rede.' });
      }, CONFIG.REQUEST_TIMEOUT);

      window[callbackName] = function(dados) {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(dados);
      };

      const separator = url.includes('?') ? '&' : '?';
      const script = document.createElement('script');
      script.src = `${url}${separator}callback=${callbackName}`;
      script.onerror = function() {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve({ sucesso: false, mensagem: 'Erro de conexão. Verifique sua rede WiFi.' });
      };
      document.body.appendChild(script);
    });
  },

  // Fallback POST: converte para GET com dados encodados
  async postFallback(dados) {
    const params = { ...dados };
    return await this.get(params);
  }
};
