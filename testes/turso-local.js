// turso-local.js - Servidor de testes que imita a API HTTP do Turso (/v2/pipeline)
// usando o SQLite embutido do Node. Usado so nos testes automaticos.
'use strict';
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

function criar(arquivoSchema) {
  const db = new DatabaseSync(':memory:');
  if (arquivoSchema) db.exec(require('fs').readFileSync(arquivoSchema, 'utf8'));

  const val = a => {
    if (!a || a.type === 'null') return null;
    if (a.type === 'integer') return Number(a.value);
    if (a.type === 'float') return Number(a.value);
    return a.value;
  };
  const cel = v => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
    if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
    return { type: 'text', value: String(v) };
  };

  function executar(s) {
    const st = db.prepare(s.sql);
    const args = (s.args || []).map(val);
    const cols = st.columns ? st.columns().map(c => ({ name: c.name, decltype: null })) : [];
    const rows = st.all(...args);
    const ch = db.prepare('SELECT changes() AS c, last_insert_rowid() AS r').get();
    const nomes = cols.length ? cols.map(c => c.name) : (rows[0] ? Object.keys(rows[0]) : []);
    return {
      cols: nomes.map(n => ({ name: n, decltype: null })),
      rows: rows.map(r => nomes.map(n => cel(r[n]))),
      affected_row_count: /^\s*(insert|update|delete)/i.test(s.sql) ? Number(ch.c) : 0,
      last_insert_rowid: String(ch.r)
    };
  }
  const erroDe = e => ({ message: e.message, code: e.code || (/constraint/i.test(e.message) ? 'SQLITE_CONSTRAINT' : 'SQLITE_ERROR') });

  function cond(c, ok, er) {
    if (!c) return true;
    if (c.type === 'ok') return ok[c.step] === true;
    if (c.type === 'error') return er[c.step] === true;
    if (c.type === 'not') return !cond(c.cond, ok, er);
    if (c.type === 'and') return c.conds.every(x => cond(x, ok, er));
    if (c.type === 'or') return c.conds.some(x => cond(x, ok, er));
    return false;
  }

  const stats = { requisicoes: 0 };
  const servidor = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let corpo = '';
    req.on('data', d => { corpo += d; });
    req.on('end', () => {
      stats.requisicoes++;
      const { requests } = JSON.parse(corpo);
      const results = requests.map(r => {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        if (r.type === 'execute') {
          try { return { type: 'ok', response: { type: 'execute', result: executar(r.stmt) } }; }
          catch (e) { return { type: 'error', error: erroDe(e) }; }
        }
        if (r.type === 'batch') {
          const ok = [], er = [], step_results = [], step_errors = [];
          r.batch.steps.forEach((s, i) => {
            if (!cond(s.condition, ok, er)) { ok[i] = false; er[i] = false; step_results.push(null); step_errors.push(null); return; }
            try { step_results.push(executar(s.stmt)); step_errors.push(null); ok[i] = true; er[i] = false; }
            catch (e) { step_results.push(null); step_errors.push(erroDe(e)); ok[i] = false; er[i] = true; }
          });
          return { type: 'ok', response: { type: 'batch', result: { step_results, step_errors } } };
        }
        return { type: 'error', error: { message: 'tipo nao suportado' } };
      });
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  });
  return { db, servidor, stats };
}
module.exports = { criar };
