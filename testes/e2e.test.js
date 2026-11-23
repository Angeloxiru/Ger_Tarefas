// e2e.test.js - Teste de ponta a ponta do app com um banco Turso simulado (testes/turso-local.js).
// Requer Node 22+ e Playwright com Chromium. Uso: node --no-warnings testes/e2e.test.js
// Opcional: SHOTS=<pasta> para salvar prints das telas.
const fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const { criar } = require('./turso-local.js');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS;

const mock = criar(ROOT + '/db/schema.sql');
mock.db.exec(`
  INSERT INTO funcionarios (codigo, nome, nome_completo, cargo, ativo, perfil, senha) VALUES
   ('PL4','João','João da Silva','aux',1,'funcionario',NULL), ('MR2','Maria','Maria Souza','aux',1,'funcionario',NULL),
   ('GS1','Gestor Ana','Ana Lima','gestor',1,'gestor',NULL), ('AD1','Angelo','Angelo Adm','adm',1,'adm','1234'),
   ('XX9','Inativo','Inativo','aux',0,'funcionario',NULL);
  INSERT INTO tarefas VALUES ('T001','Carregamento',1,300,1),('T003','Conferência',0,240,1);
  INSERT INTO docas VALUES ('11W00101A','Doca 1');
  INSERT INTO coletores (coletor) VALUES ('GC07'),('GC08');
  INSERT INTO config VALUES ('timeout_padrao_min','240');`);

const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => mock.servidor.listen(5810, r));
  await new Promise(r => srv.listen(8766, r));
  const BASE = 'http://localhost:8766/';
  const browser = await chromium.launch();
  const erros = [];
  let reqs = 0;
  async function pagina(ctx) {
    const page = await ctx.newPage();
    page.on('pageerror', e => erros.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route('https://tarefas-angeloxiru.aws-us-east-1.turso.io/**', async route => {
      reqs++;
      const r = await fetch('http://localhost:5810/v2/pipeline', { method: 'POST', body: route.request().postData() });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: await r.text() });
    });
    return page;
  }
  const shot = (p, n) => SHOTS ? p.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
  const bipar = async (p, sel, txt) => { await p.fill(sel, txt); await p.press(sel, 'Enter'); };
  const logar = async (p, c) => { await p.waitForSelector('#codigo-manual'); await bipar(p, '#codigo-manual', c); };
  const q = sql => mock.db.prepare(sql).all();
  const ok = (n) => console.log('OK  ', n);

  const coletor = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true });
  let page = await pagina(coletor);
  await page.goto(BASE + 'index.html');
  await page.waitForSelector('#coletor-vinculo-input');
  await logar(page, 'PL4');
  await page.waitForFunction(() => document.getElementById('login-msg').textContent.includes('não foi vinculado'));
  ok('funcionário em aparelho sem vínculo é recusado');

  await bipar(page, '#coletor-vinculo-input', 'COLETOR:gc07');
  await page.waitForSelector('.coletor-login-msg.msg-success');
  ok('vínculo pelo QR COLETOR:gc07');

  await logar(page, 'XX9');
  await page.waitForFunction(() => document.getElementById('login-msg').textContent.includes('inativo'));
  ok('crachá inativo recusado');

  // João: retirar com erros
  await logar(page, 'PL4');
  await page.waitForURL(/painel\.html/);
  await page.waitForSelector('#coletor-btn-retirar');
  await page.click('#coletor-btn-retirar');
  await bipar(page, '.coletor-leitura-input', 'DEVOLUÇÃO');
  await page.waitForSelector('.coletor-leitura-erro:not(.hidden)');
  await bipar(page, '.coletor-leitura-input', 'retirada');
  await page.waitForSelector('#coletor-btn-devolver');
  assert.deepStrictEqual(q("SELECT responsavel FROM coletores WHERE coletor='GC07'")[0].responsavel, 'PL4');
  assert.strictEqual(q("SELECT COUNT(*) n FROM coletores_log WHERE acao='Retirada'")[0].n, 1);
  assert.strictEqual(q("SELECT COUNT(*) n FROM ocorrencias WHERE tipo='leitura_errada'")[0].n, 1);
  ok('retirada gravada no banco + leitura errada nas ocorrências');

  // João inicia Conferência
  await page.waitForSelector('#btn-outras');
  // painel no coletor (com vinculo): sem modo computador
  assert.ok(!(await page.evaluate(() => document.body.classList.contains('modo-computador'))));
  await page.click('#btn-outras');
  await page.click('.task-item:has-text("Conferência")');
  await page.waitForSelector('#secao-ativa:not(.hidden)');
  await shot(page, 'painel-tarefa');
  assert.strictEqual(q("SELECT COUNT(*) n FROM registros WHERE status='em_andamento' AND codigo_func='PL4'")[0].n, 1);
  ok('tarefa iniciada no banco');

  // toque duplo no banco: segunda tarefa aberta e recusada
  const dup = await page.evaluate(() => API.get({ acao: 'iniciar_tarefa', codigo_func: 'PL4', id_tarefa: 'T003' }));
  assert.strictEqual(dup.sucesso, false);
  ok('segunda tarefa aberta recusada: ' + dup.mensagem);

  // Devolver com tarefa aberta: bloqueado
  await page.click('#coletor-btn-devolver');
  await bipar(page, '.coletor-leitura-input', 'devolucao');
  await page.waitForSelector('text=Devolução não permitida');
  await page.click('text=Entendi');
  ok('devolução bloqueada com tarefa aberta');

  // Maria entra com João em tarefa: tela vermelha
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + 'index.html');
  await logar(page, 'MR2');
  await page.waitForSelector('.coletor-tela.vermelho');
  await page.waitForSelector('.coletor-tela.vermelho', { state: 'detached', timeout: 13000 });
  ok('Maria bloqueada 10s (João em tarefa)');

  // João volta e finaliza
  await logar(page, 'PL4');
  await page.waitForURL(/painel\.html/);
  await page.waitForSelector('#btn-finalizar');
  await page.click('#btn-finalizar');
  await page.click('#modal-confirmar-sim');
  await page.waitForSelector('#secao-tarefas:not(.hidden)');
  assert.strictEqual(q("SELECT status FROM registros WHERE codigo_func='PL4'")[0].status, 'finalizada');
  ok('tarefa finalizada');

  // Carregamento completo
  await page.click('#btn-carregamento button');
  await page.waitForURL(/carregamento\.html/);
  await bipar(page, '#input-doca', '11W00101A');
  await page.waitForSelector('#etapa-scan:not(.hidden)');
  await bipar(page, '#input-carga', 'C350|410');
  await page.waitForSelector('#etapa-andamento:not(.hidden)');
  await shot(page, 'carregamento-andamento');
  assert.strictEqual(q("SELECT numero_carga||'|'||qtd_volumes||'|'||doca x FROM cargas")[0].x, 'C350|410|11W00101A');
  ok('carga registrada (doca + QR de carga)');
  await page.click('#btn-finalizar');
  await page.click('#modal-confirmar-sim');
  await page.waitForSelector('#etapa-resultado:not(.hidden)');
  assert.strictEqual(q("SELECT volumes_proporcionais v FROM registros WHERE id_tarefa='T001'")[0].v, 410);
  ok('carregamento finalizado com 410 volumes para João');
  await shot(page, 'carregamento-resultado');

  // Maria assume (João sem tarefa)
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + 'index.html');
  await logar(page, 'MR2');
  await page.waitForSelector('text=Deseja assumir?');
  await page.click('.coletor-caixa-botoes >> text=Sim');
  await page.waitForURL(/painel\.html/);
  await page.waitForSelector('#coletor-btn-devolver');
  assert.strictEqual(q("SELECT responsavel FROM coletores WHERE coletor='GC07'")[0].responsavel, 'MR2');
  assert.deepStrictEqual(q("SELECT codigo_func||':'||acao||':'||origem x FROM coletores_log ORDER BY id").map(r => r.x),
    ['PL4:Retirada:app', 'PL4:Devolução:assumido', 'MR2:Retirada:assumido']);
  ok('Maria assumiu: devolução João + retirada Maria + ocorrência');

  // Maria erra 3 vezes e devolve
  await page.click('#coletor-btn-devolver');
  for (const x of ['abc', 'PL4', 'RETIRADA']) await bipar(page, '.coletor-leitura-input', x);
  await page.waitForSelector('.coletor-tela.amarelo');
  await page.click('.coletor-tela-botao');
  await page.click('#coletor-btn-devolver');
  await bipar(page, '.coletor-leitura-input', 'Devolução');
  await page.waitForSelector('.coletor-tela.verde');
  await page.waitForURL(/index\.html/, { timeout: 8000 });
  assert.strictEqual(q("SELECT responsavel FROM coletores WHERE coletor='GC07'")[0].responsavel, null);
  assert.strictEqual(q("SELECT COUNT(*) n FROM ocorrencias WHERE tipo='limite_tentativas'")[0].n, 1);
  ok('3 erros + devolução, coletor na base');

  // Timeout preguiçoso: tarefa vencida e encerrada ao consultar
  mock.db.exec("INSERT INTO registros (id_registro,codigo_func,id_tarefa,nome_tarefa,data_inicio,status) VALUES ('RVELHA','GS1','T003','Conferência','2026-01-01T10:00:00.000Z','em_andamento')");

  // ADM no computador
  const pc = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true });
  const p2 = await pagina(pc);
  await p2.goto(BASE + 'index.html');
  await logar(p2, 'AD1');
  await p2.waitForSelector('#input-senha:visible');
  await bipar(p2, '#input-senha', '1234');
  await p2.waitForURL(/gestor\.html/);
  await p2.waitForSelector('.tab-adm:not(.hidden)');
  assert.strictEqual(q("SELECT status FROM registros WHERE id_registro='RVELHA'")[0].status, 'timeout');
  ok('ADM entra no gestor; painel aplicou timeout da tarefa vencida');
  await p2.click('.tab[data-tab="adm-coletores"]');
  await p2.waitForSelector('#adm-coletores-lista .desk-col');   // computador: painel em cartoes
  assert.ok(await p2.evaluate(() => document.body.classList.contains('modo-computador')));
  await shot(p2, 'adm-coletores');
  await p2.click('.tab[data-tab="adm-irregularidades"]');
  await p2.waitForSelector('.adm-oc');
  assert.ok(await p2.locator('.adm-oc').count() >= 5);
  await shot(p2, 'adm-irregularidades');
  ok('telas Coletores e Irregularidades');
  await p2.click('.tab[data-tab="adm-exportacao"]');
  const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('text=Gerar Excel')]);
  const arq = path.join(require('os').tmpdir(), 'exp-teste.xlsx'); await dl.saveAs(arq);
  const XLSX = require(ROOT + '/js/vendor/xlsx.full.min.js');
  const rows = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(arq)).Sheets['Exportação'], { header: 1 });
  console.log('   exportação:', JSON.stringify(rows));
  assert.deepStrictEqual(rows[0], ['Tarefas Diárias', 'Qtd de Tarefas', 'Qtd Itens', 'Soma de Tempo', 'Volume por hora', 'Nome do funcionário', 'Data']);
  const carreg = rows.find(r => r[0] === 'Carregamento');
  assert.strictEqual(carreg[2], 410); assert.ok(carreg[4] > 0); assert.strictEqual(carreg[5], 'João da Silva');
  await shot(p2, 'adm-exportacao');
  ok('exportação xlsx com itens e volume por hora');

  // Tempo Real no computador: ordenação (em tarefa primeiro), busca e horário da atualização
  await p2.click('.tab[data-tab="tempo-real"]');
  await p2.waitForSelector('#desk-busca-func');
  await p2.waitForFunction(() => document.getElementById('desk-atualizado').textContent.includes('1 min'));
  await p2.fill('#desk-busca-func', 'mar');
  const visiveis = await p2.$$eval('#lista-funcionarios .func-card', cs => cs.filter(c => c.style.display !== 'none').map(c => c.querySelector('.func-name').textContent));
  assert.deepStrictEqual(visiveis, ['Maria']);
  ok('Tempo Real: busca por nome e atualização a cada 1 min');

  // Conserto: ADM envia GC08 para conserto pelo painel
  await p2.click('.tab[data-tab="adm-coletores"]');
  await p2.click('.desk-col[data-coletor="GC08"]');
  await p2.click('.desk-conserto[data-v="1"]');
  await p2.waitForSelector('.desk-col.conserto[data-coletor="GC08"]');
  assert.strictEqual(q("SELECT em_conserto FROM coletores WHERE coletor='GC08'")[0].em_conserto, 1);
  assert.strictEqual(q("SELECT COUNT(*) n FROM ocorrencias WHERE tipo='conserto'")[0].n, 1);
  const ret = await p2.evaluate(() => API.get({ acao: 'coletor_registrar', coletor: 'GC08', codfun: 'PL4', movimento: 'retirada' }));
  assert.strictEqual(ret.motivo, 'em_conserto');
  ok('conserto: marcado pelo ADM e retirada recusada');

  // Coletor vinculado ao GC08 (em conserto): login recusado
  const c3 = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: 'block' });
  const p4 = await pagina(c3);
  await p4.goto(BASE + 'index.html');
  await p4.evaluate(() => localStorage.setItem('coletor_vinculado', 'GC08'));
  await p4.goto(BASE + 'index.html');
  await logar(p4, 'PL4');
  await p4.waitForFunction(() => document.getElementById('login-msg').textContent.includes('em conserto'));
  ok('login no coletor em conserto avisa para usar outro');

  // Liberar do conserto
  await p2.click('.desk-col[data-coletor="GC08"]');
  await p2.click('.desk-conserto[data-v="0"]');
  await p2.waitForSelector('.desk-col.base[data-coletor="GC08"]');
  ok('conserto liberado');

  // Histórico no computador: filtro por tarefa e Excel do que está na tela
  await p2.click('.tab[data-tab="historico"]');
  await p2.waitForFunction(() => document.querySelectorAll('#desk-hist-tarefa option').length > 1);
  await p2.selectOption('#desk-hist-tarefa', 'T001');
  await p2.click('.desk-botao-buscar');
  await p2.waitForSelector('#desk-hist-excel');
  const [dl2] = await Promise.all([p2.waitForEvent('download'), p2.click('#desk-hist-excel')]);
  const arq2 = path.join(require('os').tmpdir(), 'hist-teste.xlsx'); await dl2.saveAs(arq2);
  const h = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(arq2)).Sheets['Histórico'], { header: 1 });
  assert.deepStrictEqual(h[0], ['Funcionário', 'Código', 'Tarefa', 'Início', 'Fim', 'Duração', 'Situação', 'Doca', 'Carga', 'Volumes']);
  assert.ok(h.length === 2 && h[1][2] === 'Carregamento' && h[1][9] === 410, JSON.stringify(h));
  ok('histórico filtrado por tarefa e baixado em Excel');

  // Gestor comum não vê abas ADM
  const p3 = await pagina(pc);
  await p3.goto(BASE + 'index.html');
  await p3.evaluate(() => sessionStorage.clear());
  await p3.goto(BASE + 'index.html');
  await logar(p3, 'GS1');
  await p3.waitForSelector('.func-card');
  assert.strictEqual(await p3.locator('.tab-adm:not(.hidden)').count(), 0);
  await p3.click('.tab[data-tab="historico"]'); await p3.click('#tab-historico button:has-text("Buscar")'); await p3.waitForSelector('#tabela-historico table, #tabela-historico .card');
  await p3.click('.tab[data-tab="raiox"]');
  ok('gestor comum sem abas ADM; histórico abre');

  console.log('\nRequisições ao banco:', reqs, '| erros JS:', erros.length ? erros : 'nenhum');
  assert.strictEqual(erros.length, 0);
  console.log('E2E v11 OK');
  await browser.close(); srv.close(); mock.servidor.close();
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
