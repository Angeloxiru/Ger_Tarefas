// aplicar.js - Cria o esquema e carrega os dados convertidos no banco Turso
//
// Uso:
//   node db/aplicar.js <url> <token> [dados.json] [--substituir]
//
// - Sempre aplica db/schema.sql (idempotente: CREATE ... IF NOT EXISTS).
// - Com dados.json, insere os dados em lotes transacionais.
// - --substituir apaga os dados existentes antes (para reimportar na virada).
'use strict';
const fs = require('fs');
const path = require('path');
const DB = require('../js/db.js');

const TABELAS = ['ocorrencias', 'coletores_log', 'coletores', 'alertas', 'cargas', 'registros', 'config', 'docas', 'tarefas', 'funcionarios'];

function comandosDoSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  return sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

async function main() {
  const [url, token, arquivo] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const substituir = process.argv.includes('--substituir');
  if (!url || !token) throw new Error('Uso: node db/aplicar.js <url> <token> [dados.json] [--substituir]');
  DB.configurar(url, token);
  DB.timeoutMs = 60000;

  for (const s of comandosDoSchema()) await DB.executar(s, []);
  console.log('Esquema aplicado.');
  if (!arquivo) return;

  const { comandos } = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (substituir) {
    await DB.transacao(TABELAS.map(t => [`DELETE FROM ${t}`, []]));
    console.log('Dados anteriores apagados.');
  }
  const LOTE = 400;
  for (let i = 0; i < comandos.length; i += LOTE) {
    await DB.transacao(comandos.slice(i, i + LOTE));
    process.stdout.write(`\r${Math.min(i + LOTE, comandos.length)}/${comandos.length} comandos`);
  }
  console.log('\nContagens no banco:');
  for (const t of TABELAS.slice().reverse()) {
    const r = await DB.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(14)} ${r[0].n}`);
  }
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
