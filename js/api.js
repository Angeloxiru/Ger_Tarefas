// api.js - Camada de comunicacao com Google Apps Script
// Retry automatico com backoff exponencial e toast de feedback

const API = {

  // GET com retry automatico
  async get(params) {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${CONFIG.API_URL}?${query}`;
    return await this._executar(() => this._fetchGet(url), url, null);
  },

  // POST com retry automatico
  async post(dados) {
    return await this._executar(() => this._fetchPost(dados), null, dados);
  },

  // Orquestra tentativas com backoff e fallback JSONP na ultima rodada
  async _executar(fn, urlGet, dadosPost) {
    const max = CONFIG.MAX_TENTATIVAS;

    for (let t = 1; t <= max; t++) {
      if (t > 1) {
        this._mostrarToast(`Sem resposta, tentando novamente (${t}/${max})...`);
        await this._esperar(CONFIG.DELAY_RETRY_MS * (t - 1));
      }

      try {
        const resultado = await fn();
        this._esconderToast();
        return resultado;
      } catch (e) {
        if (t < max) continue;

        // Esgotou tentativas normais: tenta JSONP como ultimo recurso
        this._esconderToast();
        if (urlGet)    return await this.getFallback(urlGet);
        if (dadosPost) return await this.postFallback(dadosPost);
        return { sucesso: false, mensagem: 'Sem conexão. Verifique o WiFi e tente novamente.' };
      }
    }
  },

  // Fetch GET com timeout controlado
  async _fetchGet(url) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      clearTimeout(t);
      return await r.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  },

  // Fetch POST com timeout controlado
  async _fetchPost(dados) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
    try {
      const r = await fetch(CONFIG.API_URL, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(dados)
      });
      clearTimeout(t);
      return await r.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  },

  // Fallback JSONP para contornar CORS (ultimo recurso)
  async getFallback(url) {
    return new Promise((resolve) => {
      const callbackName = '_cb_' + Date.now();
      const timeout = setTimeout(() => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve({ sucesso: false, mensagem: 'Sem conexão. Verifique o WiFi e tente novamente.' });
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
        resolve({ sucesso: false, mensagem: 'Sem conexão. Verifique o WiFi e tente novamente.' });
      };
      document.body.appendChild(script);
    });
  },

  async postFallback(dados) {
    return await this.get(dados);
  },

  // Toast de feedback durante retry (criado dinamicamente, sem depender do HTML)
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
  },

  _esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
