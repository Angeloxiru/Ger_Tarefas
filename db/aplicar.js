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

// Colunas acrescentadas depois da criacao do banco (ALTER TABLE ... ADD COLUMN).
// Se a coluna ja existe, o erro "duplicate column" e ignorado.
const MIGRACOES = [
  "ALTER TABLE coletores ADD COLUMN em_conserto INTEGER NOT NULL DEFAULT 0 CHECK (em_conserto IN (0, 1))"
];

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

  const cmds = comandosDoSchema();
  // 1) tabelas (CREATE TABLE IF NOT EXISTS), 2) migracoes de colunas, 3) indices e views
  for (const s of cmds.filter(c => /^CREATE TABLE/i.test(c))) await DB.executar(s, []);
  for (const m of MIGRACOES) {
    try { await DB.executar(m, []); console.log('Migração aplicada:', m.slice(0, 60)); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
  for (const s of cmds.filter(c => !/^CREATE TABLE/i.test(c))) await DB.executar(s, []);
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
