// rotinas.js - Rotinas agendadas (substituem os gatilhos do Google Apps Script)
//
// Roda pelo GitHub Actions a cada 30 minutos (.github/workflows/rotinas.yml):
// 1. Encerra por timeout as tarefas que passaram do tempo maximo
// 2. Registra em "ocorrencias" coletor fora da base ha mais de 6h (uma vez por retirada)
// 3. Apaga o log de coletores com mais de 7 dias e ocorrencias com mais de 45 dias
//
// Uso local: node scripts/rotinas.js
'use strict';
const fs = require('fs');
const path = require('path');
const DB = require('../js/db.js');
const Backend = require('../js/backend.js');

function credenciais() {
  if (process.env.TURSO_URL && process.env.TURSO_TOKEN) {
    return { url: process.env.TURSO_URL, token: process.env.TURSO_TOKEN };
  }
  // Sem variaveis de ambiente: usa as mesmas do app (js/config.js)
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const url = (cfg.match(/TURSO_URL:\s*'([^']+)'/) || [])[1];
  const token = (cfg.match(/TURSO_TOKEN:\s*'([^']+)'/) || [])[1];
  return { url, token };
}

async function main() {
  const { url, token } = credenciais();
  if (!url || !token) throw new Error('TURSO_URL/TURSO_TOKEN não encontrados.');
  DB.configurar(url, token);
  DB.timeoutMs = 30000;

  const timeouts = await Backend.aplicarTimeouts();
  const atrasados = await Backend.rotinaColetores6h();
  const limpeza = await Backend.rotinaLimpeza();
  console.log(JSON.stringify({ quando: new Date().toISOString(), timeouts, coletores_6h: atrasados, apagados: limpeza }));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
