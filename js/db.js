// db.js - Cliente HTTP do Turso (libSQL, protocolo Hrana "pipeline")
//
// Funciona no navegador (app) e no Node 18+ (rotinas do GitHub Actions).
// Cada chamada e uma unica requisicao HTTPS ao banco.

(function (raiz) {
  'use strict';

  function argumento(v) {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return { type: 'integer', value: String(v) };
      return { type: 'float', value: v };
    }
    return { type: 'text', value: String(v) };
  }

  function valor(c) {
    if (!c || c.type === 'null') return null;
    if (c.type === 'integer') return Number(c.value);
    if (c.type === 'float') return Number(c.value);
    return c.value; // text / blob (base64)
  }

  function linhas(resultado) {
    if (!resultado) return [];
    const nomes = resultado.cols.map(c => c.name);
    return resultado.rows.map(r => {
      const o = {};
      for (let i = 0; i < nomes.length; i++) o[nomes[i]] = valor(r[i]);
      return o;
    });
  }

  function stmt(sql, args) {
    return { sql, args: (args || []).map(argumento) };
  }

  class ErroBanco extends Error {
    constructor(mensagem, codigo) {
      super(mensagem);
      this.codigo = codigo || '';
      this.restricao = /UNIQUE constraint|SQLITE_CONSTRAINT/i.test(mensagem + ' ' + this.codigo);
    }
  }

  const DB = {
    url: '',
    token: '',
    timeoutMs: 12000,
    tentativas: 3,
    aoTentarNovamente: null,   // callback(tentativa, max) para o app mostrar aviso
    aoConcluir: null,

    configurar(url, token) {
      this.url = String(url || '').replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
      this.token = token || '';
    },

    async _pipeline(requests) {
      const corpo = JSON.stringify({ requests: requests.concat([{ type: 'close' }]) });
      let ultimoErro = null;
      for (let t = 1; t <= this.tentativas; t++) {
        if (t > 1) {
          if (this.aoTentarNovamente) this.aoTentarNovamente(t, this.tentativas);
          await new Promise(r => setTimeout(r, 400 * (t - 1)));
        }
        const controle = new AbortController();
        const timer = setTimeout(() => controle.abort(), this.timeoutMs);
        try {
          const resp = await fetch(this.url + '/v2/pipeline', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + this.token, 'Content-Type': 'application/json' },
            body: corpo,
            signal: controle.signal
          });
          clearTimeout(timer);
          if (resp.status >= 500 || resp.status === 429) {
            ultimoErro = new ErroBanco('Banco indisponível (HTTP ' + resp.status + ')');
            continue;
          }
          const json = await resp.json();
          if (!resp.ok) throw new ErroBanco((json && (json.message || json.error)) || ('HTTP ' + resp.status));
          if (this.aoConcluir) this.aoConcluir();
          return json.results;
        } catch (e) {
          clearTimeout(timer);
          if (e instanceof ErroBanco) throw e;
          ultimoErro = e; // rede/timeout: tenta de novo
        }
      }
      if (this.aoConcluir) this.aoConcluir();
      throw new ErroBanco('Sem conexão com o banco. Verifique o WiFi e tente novamente.', 'REDE');
    },

    _checar(res) {
      if (!res) throw new ErroBanco('Resposta vazia do banco.');
      if (res.type === 'error') throw new ErroBanco(res.error.message, res.error.code);
      return res.response;
    },

    // SELECT -> lista de objetos
    async query(sql, args) {
      const r = await this._pipeline([{ type: 'execute', stmt: stmt(sql, args) }]);
      return linhas(this._checar(r[0]).result);
    },

    // Qualquer comando -> { linhas, alteradas, ultimoId }
    async executar(sql, args) {
      const r = await this._pipeline([{ type: 'execute', stmt: stmt(sql, args) }]);
      const res = this._checar(r[0]).result;
      return { linhas: linhas(res), alteradas: res.affected_row_count, ultimoId: res.last_insert_rowid };
    },

    // Varias consultas independentes numa so requisicao -> lista de listas de objetos
    async varias(lista) {
      const r = await this._pipeline(lista.map(([sql, args]) => ({ type: 'execute', stmt: stmt(sql, args) })));
      return r.map(x => linhas(this._checar(x).result));
    },

    // Transacao atomica: tudo ou nada. lista = [[sql, args], ...]
    // Retorna [{ linhas, alteradas }] na mesma ordem.
    async transacao(lista) {
      const n = lista.length;
      const steps = [{ stmt: { sql: 'BEGIN' } }];
      lista.forEach(([sql, args], i) => {
        steps.push({ stmt: stmt(sql, args), condition: { type: 'ok', step: i } });
      });
      steps.push({ stmt: { sql: 'COMMIT' }, condition: { type: 'ok', step: n } });
      steps.push({ stmt: { sql: 'ROLLBACK' }, condition: { type: 'not', cond: { type: 'ok', step: n + 1 } } });

      const r = await this._pipeline([{ type: 'batch', batch: { steps } }]);
      const b = this._checar(r[0]).result;
      for (let i = 1; i <= n + 1; i++) {
        if (b.step_errors[i]) throw new ErroBanco(b.step_errors[i].message, b.step_errors[i].code);
      }
      return b.step_results.slice(1, n + 1).map(x => ({ linhas: linhas(x), alteradas: x ? x.affected_row_count : 0 }));
    }
  };

  DB.ErroBanco = ErroBanco;
  raiz.DB = DB;
  if (typeof module !== 'undefined' && module.exports) module.exports = DB;
})(typeof window !== 'undefined' ? window : globalThis);
