// backend.js - Regras do sistema, direto no banco Turso
//
// Substitui o Google Apps Script (Code.gs, Tarefas.gs, Carregamento.gs, Gestor.gs,
// Timeout.gs) e a API do Ger_Gestao_Coletores. Cada acao devolve o mesmo formato
// de antes: { sucesso, dados, mensagem }, para as telas continuarem iguais.
//
// Usado pelo app (navegador) e pelas rotinas agendadas (Node, GitHub Actions).

(function (raiz) {
  'use strict';

  const DB = raiz.DB || (typeof require !== 'undefined' ? require('./db.js') : null);
  const VERSAO = 'turso-1';
  const TZ = 'America/Sao_Paulo';
  const OFFSET = '-03:00';               // Brasil sem horario de verao desde 2019
  const ALERTA_PAINEL_MS = 3 * 60 * 60 * 1000;

  // ============================ Datas ============================

  const agoraISO = () => new Date().toISOString();

  // Partes da data/hora no horario de Brasilia
  function partesSP(d) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    const p = {};
    f.formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
    return p;
  }

  function carimboSP(d) {             // aaaammddhhmmss
    const p = partesSP(d);
    return p.year + p.month + p.day + p.hour + p.minute + p.second;
  }

  function diaSP(d) {                 // aaaa-mm-dd
    const p = partesSP(d);
    return `${p.year}-${p.month}-${p.day}`;
  }

  // Inicio do dia (Brasilia) em UTC ISO
  function inicioDiaUTC(dia) {
    return new Date(`${dia}T00:00:00.000${OFFSET}`).toISOString();
  }

  function somarDias(dia, n) {
    const d = new Date(`${dia}T12:00:00.000${OFFSET}`);
    d.setUTCDate(d.getUTCDate() + n);
    return diaSP(d);
  }

  // Intervalo [inicio, fim) em UTC para filtros de dia inicial/final (inclusive)
  function intervalo(diaIni, diaFim) {
    return {
      ini: diaIni ? inicioDiaUTC(diaIni) : '0000',
      fim: diaFim ? inicioDiaUTC(somarDias(diaFim, 1)) : '9999'
    };
  }

  const ms = iso => (iso ? new Date(iso).getTime() : NaN);
  const cod = v => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  const bool = v => v === true || v === 1 || v === '1' || v === 'true';

  function erro(mensagem, extra) {
    return Object.assign({ sucesso: false, mensagem }, extra || {});
  }

  // ============================ Login ============================

  async function verificarCracha(p) {
    const codigo = cod(p.codigo);
    if (!codigo) return erro('Código do crachá não informado.');
    const r = await DB.query('SELECT nome, ativo, senha FROM funcionarios WHERE codigo = ?', [codigo]);
    if (!r.length) return erro('Crachá não encontrado. Verifique o código.');
    if (!r[0].ativo) return erro('Funcionário inativo. Procure o supervisor.');
    return { sucesso: true, dados: { nome: r[0].nome, requer_senha: !!String(r[0].senha || '').trim() } };
  }

  async function login(p) {
    const codigo = cod(p.codigo);
    if (!codigo) return erro('Código do crachá não informado.');
    const r = await DB.query('SELECT codigo, nome, cargo, ativo, perfil, senha FROM funcionarios WHERE codigo = ?', [codigo]);
    if (!r.length) return erro('Crachá não encontrado. Verifique o código.');
    const f = r[0];
    if (!f.ativo) return erro('Funcionário inativo. Procure o supervisor.');
    const senha = String(f.senha || '').trim();
    if (senha && String(p.senha || '').trim() !== senha) return erro('Senha incorreta.');
    return {
      sucesso: true,
      dados: { codigo: String(f.codigo).trim(), nome: f.nome, cargo: f.cargo, perfil: f.perfil || 'funcionario' },
      mensagem: 'Login realizado com sucesso.'
    };
  }

  // ============================ Tarefas ============================

  async function listarTarefas() {
    const r = await DB.query('SELECT id_tarefa, nome, usa_qrcode_carga, tempo_maximo_min FROM tarefas WHERE ativa = 1 ORDER BY id_tarefa');
    return { sucesso: true, dados: r.map(t => Object.assign(t, { usa_qrcode_carga: bool(t.usa_qrcode_carga) })) };
  }

  const SQL_ABERTA = `
    SELECT r.id_registro, r.codigo_func, r.id_tarefa, r.nome_tarefa, r.data_inicio, r.status,
           COALESCE(t.tempo_maximo_min, 240) AS tempo_maximo_min,
           c.numero_carga, c.qtd_volumes, c.doca, c.data_leitura, d.nome AS nome_doca
    FROM registros r
    LEFT JOIN tarefas t ON t.id_tarefa = r.id_tarefa
    LEFT JOIN cargas c  ON c.id = (SELECT MIN(x.id) FROM cargas x WHERE x.id_registro = r.id_registro)
    LEFT JOIN docas d   ON d.codigo = c.doca
    WHERE r.codigo_func = ? AND r.status = 'em_andamento'`;

  function vencida(reg) {
    return Date.now() - ms(reg.data_inicio) >= Number(reg.tempo_maximo_min || 240) * 60000;
  }

  async function statusFuncionario(p) {
    const codigo = cod(p.codigo);
    if (!codigo) return erro('Código do funcionário não informado.');
    const r = await DB.query(SQL_ABERTA, [codigo]);
    if (!r.length) return { sucesso: true, dados: { tarefa_ativa: null } };

    const reg = r[0];
    // Passou do tempo maximo: encerra por timeout agora (nao espera a rotina de 30 min)
    if (vencida(reg)) {
      await encerrarPorTimeout(reg.id_registro);
      return { sucesso: true, dados: { tarefa_ativa: null } };
    }
    const tarefa = {
      id_registro: reg.id_registro, id_tarefa: reg.id_tarefa, nome_tarefa: reg.nome_tarefa,
      data_inicio: reg.data_inicio, status: reg.status
    };
    if (reg.numero_carga !== null) {
      tarefa.carga = {
        numero_carga: reg.numero_carga, qtd_volumes: reg.qtd_volumes, doca: reg.doca || '',
        nome_doca: reg.nome_doca || '', data_leitura: reg.data_leitura
      };
    }
    return { sucesso: true, dados: { tarefa_ativa: tarefa } };
  }

  async function iniciarTarefa(p) {
    const codigo = cod(p.codigo_func);
    const idTarefa = String(p.id_tarefa || '').trim();
    if (!codigo || !idTarefa) return erro('Dados incompletos.');

    const st = await statusFuncionario({ codigo });
    if (st.sucesso && st.dados.tarefa_ativa) return erro('Você já tem uma tarefa em andamento. Finalize-a primeiro.');

    const t = await DB.query('SELECT nome FROM tarefas WHERE id_tarefa = ?', [idTarefa]);
    if (!t.length) return erro('Tarefa não encontrada.');

    const agora = new Date();
    const base = 'R' + carimboSP(agora) + codigo;
    for (let n = 1; n <= 3; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        await DB.executar(
          `INSERT INTO registros (id_registro, codigo_func, id_tarefa, nome_tarefa, data_inicio, status)
           VALUES (?, ?, ?, ?, ?, 'em_andamento')`,
          [id, codigo, idTarefa, t[0].nome, agora.toISOString()]);
        return {
          sucesso: true,
          dados: { id_registro: id, id_tarefa: idTarefa, nome_tarefa: t[0].nome, data_inicio: agora.toISOString(), status: 'em_andamento' },
          mensagem: 'Tarefa iniciada com sucesso.'
        };
      } catch (e) {
        if (!e.restricao) throw e;
        // Toque duplo: ja existe tarefa aberta para esta pessoa
        if (/codigo_func/.test(e.message) || /ux_registros_um_aberto/.test(e.message)) {
          return erro('Você já tem uma tarefa em andamento. Finalize-a primeiro.');
        }
        const aberta = await DB.query("SELECT 1 FROM registros WHERE codigo_func = ? AND status = 'em_andamento'", [codigo]);
        if (aberta.length) return erro('Você já tem uma tarefa em andamento. Finalize-a primeiro.');
        // colisao de ID (mesmo segundo): tenta com sufixo
      }
    }
    return erro('Não foi possível iniciar a tarefa. Tente novamente.');
  }

  async function finalizarTarefa(p) {
    const codigo = cod(p.codigo_func);
    const idRegistro = String(p.id_registro || '').trim();
    if (!codigo || !idRegistro) return erro('Dados incompletos.');

    const agora = agoraISO();
    const up = await DB.executar(
      `UPDATE registros SET data_fim = ?, status = 'finalizada', finalizado_por = 'funcionario'
       WHERE id_registro = ? AND codigo_func = ? AND status = 'em_andamento'
       RETURNING id_tarefa`, [agora, idRegistro, codigo]);
    if (up.linhas.length) {
      return montarResultadoFinalizacao(idRegistro, agora, true, codigo, up.linhas[0].id_tarefa);
    }

    const r = await DB.query('SELECT status, data_fim, id_tarefa FROM registros WHERE id_registro = ? AND codigo_func = ?', [idRegistro, codigo]);
    if (!r.length) return erro('Registro não encontrado.');
    if (r[0].status === 'finalizada') {
      return montarResultadoFinalizacao(idRegistro, r[0].data_fim, false, codigo, r[0].id_tarefa);
    }
    return erro('Esta tarefa foi encerrada automaticamente por tempo (timeout).');
  }

  async function montarResultadoFinalizacao(idRegistro, dataFim, recalcular, codigo, idTarefa) {
    const resultado = {
      sucesso: true,
      dados: { id_registro: idRegistro, data_fim: dataFim, status: 'finalizada' },
      mensagem: 'Tarefa finalizada com sucesso.'
    };
    const ctx = await contextoCarga(idRegistro);
    if (!ctx || !ctx.usa_carga) return resultado;

    if (ctx.total_workers === 1 && !ctx.tem_ajudante) {
      if (recalcular) {
        await DB.executar('UPDATE registros SET volumes_proporcionais = ? WHERE id_registro = ?', [ctx.qtd_volumes, idRegistro]);
      }
      resultado.dados.distribuicao = [{
        codigo_func: codigo, nome_func: ctx.nome_func || codigo,
        volumes_proporcionais: ctx.qtd_volumes, percentual: '100.0', status: 'finalizada'
      }];
      return resultado;
    }

    const dist = await calcularDistribuicao(ctx.numero_carga, ctx.qtd_volumes);
    resultado.dados.distribuicao = dist;
    if (recalcular) await salvarDistribuicao(ctx.numero_carga, dist);
    return resultado;
  }

  // Carga do registro + quantos registros ha na mesma carga + se tem ajudante
  async function contextoCarga(idRegistro) {
    const r = await DB.query(`
      SELECT c.numero_carga, c.qtd_volumes, c.doca, t.usa_qrcode_carga AS usa_carga, f.nome AS nome_func,
             (SELECT COUNT(*) FROM cargas x WHERE x.numero_carga = c.numero_carga) AS total_workers,
             (SELECT MAX(x.ajudante) FROM cargas x WHERE x.numero_carga = c.numero_carga) AS tem_ajudante
      FROM cargas c
      JOIN registros r ON r.id_registro = c.id_registro
      LEFT JOIN tarefas t ON t.id_tarefa = r.id_tarefa
      LEFT JOIN funcionarios f ON f.codigo = r.codigo_func
      WHERE c.id_registro = ?
      ORDER BY c.id LIMIT 1`, [idRegistro]);
    if (!r.length) return null;
    const c = r[0];
    return {
      numero_carga: c.numero_carga, qtd_volumes: Number(c.qtd_volumes), doca: c.doca,
      usa_carga: bool(c.usa_carga), nome_func: c.nome_func,
      total_workers: Number(c.total_workers), tem_ajudante: bool(c.tem_ajudante)
    };
  }

  async function linhasDaCarga(numeroCarga) {
    return DB.query(`
      SELECT c.id_registro, c.codigo_func, c.ajudante, c.qtd_volumes,
             r.data_inicio, r.data_fim, r.status, f.nome AS nome_func
      FROM cargas c
      LEFT JOIN registros r ON r.id_registro = c.id_registro
      LEFT JOIN funcionarios f ON f.codigo = c.codigo_func
      WHERE c.numero_carga = ?
      ORDER BY c.id`, [String(numeroCarga)]);
  }

  // Distribuicao proporcional ao tempo (mesma regra do Tarefas.gs)
  async function calcularDistribuicao(numeroCarga, totalVolumes, linhasPre) {
    const linhas = linhasPre || await linhasDaCarga(numeroCarga);
    if (!linhas.length) return [];
    const temAjudante = linhas.some(l => bool(l.ajudante));
    const agora = Date.now();
    const mapa = {};

    for (const l of linhas) {
      if (!l.status) continue;               // registro inexistente
      if (l.status === 'timeout') continue;  // timeout fica fora da distribuicao
      const c = cod(l.codigo_func);
      const ini = ms(l.data_inicio);
      const fim = l.status === 'finalizada' ? ms(l.data_fim) : agora;
      const tempo = Math.max(fim - ini, 60000);
      if (!mapa[c]) {
        mapa[c] = { codigo_func: l.codigo_func, nome_func: l.nome_func || l.codigo_func, tempo_ms: 0, status: l.status, _ini: ini, _fim: fim };
      } else {
        if (ini < mapa[c]._ini) mapa[c]._ini = ini;
        if (fim > mapa[c]._fim) mapa[c]._fim = fim;
      }
      mapa[c].tempo_ms += tempo;
      if (l.status === 'finalizada') mapa[c].status = 'finalizada';
    }

    const todos = Object.values(mapa);
    const finalizados = todos.filter(w => w.status === 'finalizada');
    const workers = finalizados.length ? finalizados : todos.filter(w => w.status !== 'finalizada');
    if (!workers.length) return [];

    if (temAjudante) {
      const menor = Math.min(...workers.map(w => w._ini));
      const maior = Math.max(...workers.map(w => w._fim));
      workers.push({
        codigo_func: 'AJUDANTE', nome_func: 'Ajudante', tempo_ms: Math.max(maior - menor, 60000),
        status: finalizados.length ? 'finalizada' : 'em_andamento', _ini: menor, _fim: maior
      });
    }

    const total = workers.reduce((s, w) => s + w.tempo_ms, 0);
    let distribuidos = 0;
    return workers.map((w, i) => {
      let vol;
      if (i === workers.length - 1) vol = totalVolumes - distribuidos;
      else { vol = Math.round((w.tempo_ms / total) * totalVolumes); distribuidos += vol; }
      return {
        codigo_func: w.codigo_func, nome_func: w.nome_func, tempo_ms: w.tempo_ms, status: w.status,
        data_inicio: new Date(w._ini).toISOString(), data_fim: new Date(w._fim).toISOString(),
        volumes_proporcionais: vol, percentual: ((w.tempo_ms / total) * 100).toFixed(1)
      };
    });
  }

  // Grava a parte de cada pessoa nos registros dela desta carga
  async function salvarDistribuicao(numeroCarga, dist) {
    const cmds = dist.filter(d => cod(d.codigo_func) !== 'AJUDANTE').map(d => [
      `UPDATE registros SET volumes_proporcionais = ?
       WHERE id_registro IN (SELECT id_registro FROM cargas WHERE numero_carga = ? AND codigo_func = ?)`,
      [d.volumes_proporcionais, String(numeroCarga), cod(d.codigo_func)]
    ]);
    if (cmds.length) await DB.transacao(cmds);
  }

  // ============================ Timeout ============================

  async function encerrarPorTimeout(idRegistro) {
    const up = await DB.executar(
      `UPDATE registros SET status = 'timeout', data_fim = ?, finalizado_por = 'sistema'
       WHERE id_registro = ? AND status = 'em_andamento' RETURNING id_registro`, [agoraISO(), idRegistro]);
    if (!up.linhas.length) return false;
    const ctx = await contextoCarga(idRegistro);
    if (ctx) {
      const dist = await calcularDistribuicao(ctx.numero_carga, ctx.qtd_volumes);
      await salvarDistribuicao(ctx.numero_carga, dist);
    }
    return true;
  }

  // Encerra todas as tarefas que passaram do tempo maximo
  async function aplicarTimeouts() {
    const vencidas = await DB.query('SELECT id_registro FROM vw_tarefas_abertas WHERE vencida = 1');
    let total = 0;
    for (const v of vencidas) {
      if (await encerrarPorTimeout(v.id_registro)) total++;
    }
    return total;
  }

  // ============================ Carregamento ============================

  async function registrarCarga(p) {
    const codigo = cod(p.codigo_func);
    const idRegistro = String(p.id_registro || '').trim();
    const numero = String(p.numero_carga || '').trim();
    const qtd = parseInt(p.qtd_volumes, 10);
    if (!codigo || !idRegistro || !numero || !qtd) return erro('Dados incompletos para registrar carga.');

    const [existente, dia] = await DB.varias([
      ['SELECT 1 FROM cargas WHERE id_registro = ?', [idRegistro]],
      ['SELECT MIN(data_leitura) AS primeira FROM cargas WHERE numero_carga = ?', [numero]]
    ]);
    if (existente.length) return erro('Este registro já tem uma carga associada.');

    const agora = new Date();
    if (dia[0] && dia[0].primeira) {
      const diaOriginal = diaSP(new Date(dia[0].primeira));
      if (diaOriginal !== diaSP(agora)) {
        const [a, m, d] = diaOriginal.split('-');
        return erro(`Carga ${numero} foi registrada em ${d}/${m}/${a}. Verifique o QRcode — cargas não passam de um dia para o outro.`);
      }
    }

    try {
      await DB.executar(
        `INSERT INTO cargas (id_registro, codigo_func, numero_carga, qtd_volumes, doca, data_leitura, ajudante)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [idRegistro, codigo, numero, qtd, String(p.doca || '').trim(), agora.toISOString(), bool(p.ajudante) ? 1 : 0]);
    } catch (e) {
      if (e.restricao) return erro('Este registro já tem uma carga associada.');
      throw e;
    }

    const n = await DB.query('SELECT COUNT(*) AS n FROM cargas WHERE numero_carga = ?', [numero]);
    const total = Number(n[0].n);
    return {
      sucesso: true,
      dados: { numero_carga: numero, qtd_volumes: qtd, total_workers: total, compartilhada: total > 1 },
      mensagem: total > 1
        ? `Carga registrada. ${total} trabalhadores nesta carga. Volumes serão distribuídos proporcionalmente.`
        : 'Carga registrada com sucesso.'
    };
  }

  async function workersCarga(p) {
    const numero = String(p.numero_carga || '').trim();
    if (!numero) return erro('Número da carga não informado.');
    const linhas = await linhasDaCarga(numero);
    if (!linhas.length) return { sucesso: true, dados: { workers: [], total: 0, tem_ajudante: false } };

    const temAjudante = linhas.some(l => bool(l.ajudante));
    const mapa = {};
    for (const l of linhas) {
      if (!l.status) continue;
      const c = cod(l.codigo_func);
      const ini = ms(l.data_inicio);
      const fim = l.data_fim ? ms(l.data_fim) : null;
      if (!mapa[c]) {
        mapa[c] = { codigo_func: l.codigo_func, nome_func: l.nome_func || l.codigo_func,
          data_inicio: l.data_inicio, data_fim: fim ? l.data_fim : null, _ini: ini, _fim: fim, status: l.status };
      } else {
        const w = mapa[c];
        if (ini < w._ini) { w._ini = ini; w.data_inicio = l.data_inicio; }
        if (fim === null) { w._fim = null; w.data_fim = null; w.status = 'em_andamento'; }
        else if (w._fim !== null && fim > w._fim) { w._fim = fim; w.data_fim = l.data_fim; }
        if (l.status === 'finalizada' && w.status !== 'em_andamento') w.status = 'finalizada';
      }
    }
    const workers = Object.values(mapa).map(w => ({
      codigo_func: w.codigo_func, nome_func: w.nome_func, data_inicio: w.data_inicio, data_fim: w.data_fim, status: w.status
    }));
    return {
      sucesso: true,
      dados: { workers, total: workers.length, qtd_volumes: Number(linhas[0].qtd_volumes), tem_ajudante: temAjudante }
    };
  }

  async function distribuicaoCarga(p) {
    const numero = String(p.numero_carga || '').trim();
    if (!numero) return erro('Número da carga não informado.');
    const linhas = await linhasDaCarga(numero);
    const total = linhas.length ? Number(linhas[0].qtd_volumes) : 0;
    if (!total) return erro('Carga não encontrada.');
    return {
      sucesso: true,
      dados: { numero_carga: numero, qtd_volumes: total, distribuicao: await calcularDistribuicao(numero, total, linhas) }
    };
  }

  async function verificarDoca(p) {
    const codigo = String(p.codigo || '').trim();
    if (!codigo) return erro('Código da doca não informado.');
    const r = await DB.query('SELECT nome FROM docas WHERE codigo = ?', [codigo]);
    if (!r.length) return erro('Doca não encontrada para o código: ' + codigo);
    return { sucesso: true, dados: { codigo, nome: r[0].nome } };
  }

  // ============================ Gestor ============================

  async function painelGestor(p) {
    await aplicarTimeouts();
    const [linhas, tarefas] = await DB.varias([[`
      SELECT f.codigo, f.nome, f.cargo, f.perfil,
             r.id_registro, r.id_tarefa, r.nome_tarefa, r.data_inicio,
             c.numero_carga, c.qtd_volumes, d.nome AS nome_doca,
             (SELECT COUNT(*) FROM cargas x WHERE x.numero_carga = c.numero_carga) AS total_workers
      FROM funcionarios f
      LEFT JOIN registros r ON r.codigo_func = f.codigo AND r.status = 'em_andamento'
      LEFT JOIN cargas c ON c.id = (SELECT MIN(x.id) FROM cargas x WHERE x.id_registro = r.id_registro)
      LEFT JOIN docas d ON d.codigo = c.doca
      WHERE f.ativo = 1
      ORDER BY f.rowid`, []],
      ['SELECT id_tarefa, nome, usa_qrcode_carga, tempo_maximo_min FROM tarefas WHERE ativa = 1 ORDER BY id_tarefa', []]
    ]);

    const agora = Date.now();
    let ativos = 0, ociosos = 0, alertas = 0;
    const funcionarios = [];
    for (const l of linhas) {
      const func = { codigo: l.codigo, nome: l.nome, cargo: l.cargo, perfil: l.perfil, tarefa_atual: null };
      if (l.id_registro) {
        func.tarefa_atual = { id_registro: l.id_registro, id_tarefa: l.id_tarefa, nome_tarefa: l.nome_tarefa, data_inicio: l.data_inicio };
        if (l.numero_carga !== null) {
          func.tarefa_atual.carga = { numero_carga: l.numero_carga, qtd_volumes: l.qtd_volumes, nome_doca: l.nome_doca || '', total_workers: Number(l.total_workers) || 1 };
        }
        ativos++;
        if (agora - ms(l.data_inicio) >= ALERTA_PAINEL_MS) alertas++;
      } else {
        ociosos++;
      }

      if (p.filtro_status) {
        if (p.filtro_status === 'ocioso' && func.tarefa_atual) continue;
        if (p.filtro_status === 'em_andamento' && !func.tarefa_atual) continue;
        if (p.filtro_status === 'alerta' && (!func.tarefa_atual || agora - ms(func.tarefa_atual.data_inicio) < ALERTA_PAINEL_MS)) continue;
      }
      if (p.filtro_tarefa && (!func.tarefa_atual || func.tarefa_atual.id_tarefa !== p.filtro_tarefa)) continue;
      funcionarios.push(func);
    }

    return {
      sucesso: true,
      dados: {
        total: linhas.length, ativos, ociosos, alertas, funcionarios,
        tarefas: tarefas.map(t => Object.assign(t, { usa_qrcode_carga: bool(t.usa_qrcode_carga) }))
      }
    };
  }

  async function historico(p) {
    const { ini, fim } = intervalo(p.data_inicio, p.data_fim);
    const filtro = String(p.funcionarios || '').split(',').map(cod).filter(Boolean);
    const condFunc = filtro.length ? ` AND codigo_func IN (${filtro.map(() => '?').join(',')})` : '';
    const campos = `id_registro, codigo_func, nome_func, nome_tarefa, data_inicio, data_fim, status, finalizado_por,
                    numero_carga, qtd_volumes, volumes_proporcionais, nome_doca, ajudante`;

    const [abertos, encerrados] = await DB.varias([
      [`SELECT ${campos} FROM vw_registros WHERE status = 'em_andamento' AND data_inicio >= ? AND data_inicio < ?${condFunc}
        ORDER BY data_inicio DESC`, [ini, fim, ...filtro]],
      [`SELECT ${campos} FROM vw_registros WHERE status <> 'em_andamento' AND data_inicio >= ? AND data_inicio < ?${condFunc}
        ORDER BY data_inicio DESC LIMIT 200`, [ini, fim, ...filtro]]
    ]);

    // Registros antigos sem volume gravado: calcula a distribuicao (uma vez por carga)
    const cacheDist = {};
    for (const r of encerrados) {
      if (r.volumes_proporcionais === null && r.numero_carga !== null) {
        const chave = r.numero_carga + '|' + r.qtd_volumes;
        if (!cacheDist[chave]) cacheDist[chave] = await calcularDistribuicao(r.numero_carga, Number(r.qtd_volumes));
        const meu = cacheDist[chave].find(d => cod(d.codigo_func) === cod(r.codigo_func));
        if (meu) r.volumes_proporcionais = meu.volumes_proporcionais;
      }
    }

    const saida = abertos.concat(encerrados).map(r => ({
      id_registro: r.id_registro, codigo_func: r.codigo_func, nome_func: r.nome_func || r.codigo_func,
      nome_tarefa: r.nome_tarefa, data_inicio: r.data_inicio, data_fim: r.data_fim, status: r.status,
      finalizado_por: r.finalizado_por || '', numero_carga: r.numero_carga, qtd_volumes: r.qtd_volumes,
      volumes_proporcionais: r.volumes_proporcionais, nome_doca: r.nome_doca || null
    }));
    return { sucesso: true, dados: saida };
  }

  async function registrarAlerta(p) {
    const codigo = cod(p.codigo_func);
    const descricao = String(p.descricao || '').trim();
    if (!codigo || !descricao) return erro('Informe o funcionário e a descrição do alerta.');
    const f = await DB.query('SELECT nome FROM funcionarios WHERE codigo = ?', [codigo]);
    if (!f.length) return erro('Funcionário não encontrado: ' + codigo);

    const agora = new Date();
    const id = 'A' + carimboSP(agora) + String(agora.getMilliseconds()).padStart(3, '0') + codigo;
    await DB.executar('INSERT INTO alertas (id_alerta, codigo_func, data_alerta, descricao, emissor) VALUES (?, ?, ?, ?, ?)',
      [id, codigo, agora.toISOString(), descricao, cod(p.codigo_emissor)]);
    return { sucesso: true, dados: { id_registro: id, nome_func: f[0].nome }, mensagem: 'Alerta registrado para ' + f[0].nome + '.' };
  }

  async function listarAlertas(p) {
    const codigo = cod(p.codigo_func);
    const r = await DB.query(`
      SELECT a.id_alerta, a.codigo_func, f.nome AS nome_func, a.data_alerta, a.descricao, a.emissor, e.nome AS nome_emissor
      FROM alertas a
      LEFT JOIN funcionarios f ON f.codigo = a.codigo_func
      LEFT JOIN funcionarios e ON e.codigo = a.emissor
      ${codigo ? 'WHERE a.codigo_func = ?' : ''}
      ORDER BY a.data_alerta DESC LIMIT 100`, codigo ? [codigo] : []);
    return {
      sucesso: true,
      dados: r.map(a => ({
        id_registro: a.id_alerta, codigo_func: a.codigo_func, nome_func: a.nome_func || a.codigo_func,
        data_alerta: a.data_alerta, descricao: a.descricao,
        emissor: a.emissor ? (a.nome_emissor || a.emissor) : ''
      }))
    };
  }

  function periodoRaiox(periodo) {
    const hoje = diaSP(new Date());
    if (periodo === 'semanal') {
      const dow = new Date(`${hoje}T12:00:00${OFFSET}`).getUTCDay(); // 0 = domingo
      return intervalo(somarDias(hoje, -dow), somarDias(hoje, 6 - dow));
    }
    if (periodo === 'mensal') {
      const [a, m] = hoje.split('-').map(Number);
      const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      return intervalo(`${a}-${String(m).padStart(2, '0')}-01`, `${a}-${String(m).padStart(2, '0')}-${ultimo}`);
    }
    return intervalo(hoje, hoje);
  }

  async function raiox(p) {
    const periodo = p.periodo || 'diario';
    const tipo = p.tipo || 'equipe';
    const codigo = cod(p.codigo_func);

    if (tipo === 'funcionarios') {
      const f = await DB.query('SELECT codigo, nome FROM funcionarios WHERE ativo = 1');
      const lista = f.map(x => ({ codigo: cod(x.codigo), nome: x.nome }))
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
      return { sucesso: true, dados: { funcionarios: lista } };
    }

    const { ini, fim } = periodoRaiox(periodo);
    const regs = await DB.query(`
      SELECT r.codigo_func, f.nome AS nome_func, r.id_tarefa, r.nome_tarefa, r.data_inicio, r.data_fim, r.volumes_proporcionais
      FROM registros r LEFT JOIN funcionarios f ON f.codigo = r.codigo_func
      WHERE r.status IN ('finalizada', 'timeout') AND r.data_inicio >= ? AND r.data_inicio < ?
      ${codigo ? 'AND r.codigo_func = ?' : ''}`, codigo ? [ini, fim, codigo] : [ini, fim]);

    const itens = regs.map(r => ({
      codigo_func: cod(r.codigo_func), nome_func: r.nome_func || r.codigo_func,
      id_tarefa: r.id_tarefa, nome_tarefa: r.nome_tarefa,
      tempo_ms: r.data_fim ? Math.max(ms(r.data_fim) - ms(r.data_inicio), 0) : 0,
      volumes: r.volumes_proporcionais === null ? null : Number(r.volumes_proporcionais)
    }));

    if (tipo === 'equipe') {
      const mapa = {};
      for (const r of itens) {
        const t = mapa[r.id_tarefa] || (mapa[r.id_tarefa] = { id_tarefa: r.id_tarefa, nome_tarefa: r.nome_tarefa, workers: {}, tem_volumes: false });
        const w = t.workers[r.codigo_func] || (t.workers[r.codigo_func] = { codigo_func: r.codigo_func, nome_func: r.nome_func, tempo_ms: 0, volumes: 0, tem_volumes: false });
        w.tempo_ms += r.tempo_ms;
        if (r.volumes !== null) { w.volumes += r.volumes; w.tem_volumes = true; t.tem_volumes = true; }
      }
      const tarefas = Object.values(mapa).map(t => ({
        id_tarefa: t.id_tarefa, nome_tarefa: t.nome_tarefa, tem_volumes: t.tem_volumes,
        workers: Object.values(t.workers).sort((a, b) => a.tempo_ms - b.tempo_ms)
      })).sort((a, b) => String(a.nome_tarefa).localeCompare(String(b.nome_tarefa), 'pt-BR'));
      return { sucesso: true, dados: { tipo: 'equipe', periodo, tarefas } };
    }

    if (tipo === 'individual') {
      if (!codigo) return erro('Código do funcionário não informado.');
      const mapa = {};
      for (const r of itens) {
        const t = mapa[r.id_tarefa] || (mapa[r.id_tarefa] = { id_tarefa: r.id_tarefa, nome_tarefa: r.nome_tarefa, tempo_ms: 0, volumes: 0, tem_volumes: false });
        t.tempo_ms += r.tempo_ms;
        if (r.volumes !== null) { t.volumes += r.volumes; t.tem_volumes = true; }
      }
      const [al, nm] = await DB.varias([
        ['SELECT COUNT(*) AS n FROM alertas WHERE codigo_func = ? AND data_alerta >= ? AND data_alerta < ?', [codigo, ini, fim]],
        ['SELECT nome FROM funcionarios WHERE codigo = ?', [codigo]]
      ]);
      return {
        sucesso: true,
        dados: {
          tipo: 'individual', periodo,
          funcionario: { codigo, nome: nm.length ? nm[0].nome : codigo },
          tarefas: Object.values(mapa).sort((a, b) => b.tempo_ms - a.tempo_ms),
          total_alertas: Number(al[0].n)
        }
      };
    }
    return erro('Tipo inválido.');
  }

  async function cadastrarFuncionario(p) {
    if (!p.codigo || !p.nome || !p.cargo || !p.senha) return erro('Preencha todos os campos obrigatórios, incluindo a senha.');
    try {
      await DB.executar('INSERT INTO funcionarios (codigo, nome, cargo, ativo, perfil, senha) VALUES (?, ?, ?, 1, ?, ?)',
        [cod(p.codigo), String(p.nome).trim(), String(p.cargo).trim(), p.perfil || 'funcionario', String(p.senha).trim()]);
    } catch (e) {
      if (e.restricao) return erro('Já existe um funcionário com este código.');
      throw e;
    }
    return { sucesso: true, mensagem: 'Funcionário cadastrado com sucesso.' };
  }

  async function cadastrarTarefa(p) {
    if (!p.nome) return erro('Informe o nome da tarefa.');
    const r = await DB.query("SELECT MAX(CAST(SUBSTR(id_tarefa, 2) AS INTEGER)) AS n FROM tarefas WHERE id_tarefa LIKE 'T%'");
    const novoId = 'T' + String((Number(r[0].n) || 0) + 1).padStart(3, '0');
    await DB.executar('INSERT INTO tarefas (id_tarefa, nome, usa_qrcode_carga, tempo_maximo_min, ativa) VALUES (?, ?, ?, ?, 1)',
      [novoId, String(p.nome).trim(), bool(p.usa_qrcode_carga) ? 1 : 0, parseInt(p.tempo_maximo_min, 10) || 240]);
    return { sucesso: true, dados: { id_tarefa: novoId }, mensagem: 'Tarefa cadastrada com sucesso.' };
  }

  // ============================ Coletores ============================
  // Mesmas respostas da antiga API do Ger_Gestao_Coletores (?api=...)

  async function situacaoColetor(coletor) {
    const r = await DB.query(`
      SELECT c.coletor, c.responsavel, c.desde, f.nome
      FROM coletores c LEFT JOIN funcionarios f ON f.codigo = c.responsavel
      WHERE c.coletor = ? AND c.ativo = 1`, [String(coletor || '').trim()]);
    if (!r.length) return { existe: false, coletor: String(coletor || '').trim() };
    const c = r[0];
    if (!c.responsavel) return { existe: true, coletor: c.coletor, na_base: true, cod_fun: '', nome: '', desde: '' };
    return { existe: true, coletor: c.coletor, na_base: false, cod_fun: c.responsavel, nome: c.nome || c.responsavel, desde: c.desde || '' };
  }

  async function buscarFuncionario(codigo) {
    const r = await DB.query('SELECT codigo, nome FROM funcionarios WHERE codigo = ? AND ativo = 1', [cod(codigo)]);
    return r.length ? { codFun: r[0].codigo, nome: r[0].nome } : null;
  }

  const ERRO_FUNC = { motivo: 'funcionario_nao_encontrado' };
  const MSG_FUNC = 'Seu crachá não está cadastrado ou está inativo. Peça ajuda ao responsável.';

  async function coletorStatus(p) {
    if (!String(p.coletor || '').trim()) return erro('Coletor não informado.');
    const sit = await situacaoColetor(p.coletor);
    if (!sit.existe) return erro(`Coletor "${sit.coletor}" não está cadastrado.`, { motivo: 'coletor_nao_encontrado' });
    return { sucesso: true, dados: sit };
  }

  async function coletorRegistrar(p) {
    const acao = String(p.movimento || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    if (acao !== 'retirada' && acao !== 'devolucao') return erro('Ação inválida.', { motivo: 'acao_invalida' });
    const func = await buscarFuncionario(p.codfun);
    if (!func) return erro(MSG_FUNC, ERRO_FUNC);
    const sit = await situacaoColetor(p.coletor);
    if (!sit.existe) return erro('Coletor não cadastrado. Peça ajuda ao responsável.', { motivo: 'coletor_nao_encontrado' });

    const agora = agoraISO();
    if (acao === 'retirada') {
      if (!sit.na_base) {
        if (cod(sit.cod_fun) === cod(func.codFun)) {
          return { sucesso: true, dados: { tipo: 'Retirada', coletor: sit.coletor, nome: func.nome, desde: sit.desde, ja_era_seu: true } };
        }
        return erro(`Este coletor está com ${sit.nome}.`, { motivo: 'outro_responsavel', dados: sit });
      }
      const r = await DB.transacao([
        ['UPDATE coletores SET responsavel = ?, desde = ?, alerta_6h_em = NULL WHERE coletor = ? AND responsavel IS NULL',
          [func.codFun, agora, sit.coletor]],
        [`INSERT INTO coletores_log (data_hora, coletor, codigo_func, nome, acao, origem)
          SELECT ?, ?, ?, ?, 'Retirada', 'app' WHERE changes() > 0`, [agora, sit.coletor, func.codFun, func.nome]]
      ]);
      if (!r[0].alteradas) return erro('Este coletor acabou de ser retirado por outra pessoa.', { motivo: 'outro_responsavel' });
      return { sucesso: true, dados: { tipo: 'Retirada', coletor: sit.coletor, nome: func.nome, desde: agora } };
    }

    if (sit.na_base) return erro('Este coletor já está na base.', { motivo: 'ja_na_base' });
    if (cod(sit.cod_fun) !== cod(func.codFun)) return erro(`Este coletor está com ${sit.nome}.`, { motivo: 'outro_responsavel', dados: sit });
    const r = await DB.transacao([
      ['UPDATE coletores SET responsavel = NULL, desde = NULL, alerta_6h_em = NULL WHERE coletor = ? AND responsavel = ?',
        [sit.coletor, func.codFun]],
      [`INSERT INTO coletores_log (data_hora, coletor, codigo_func, nome, acao, origem)
        SELECT ?, ?, ?, ?, 'Devolução', 'app' WHERE changes() > 0`, [agora, sit.coletor, func.codFun, func.nome]]
    ]);
    if (!r[0].alteradas) return erro('Este coletor não está mais com você.', { motivo: 'outro_responsavel' });
    return { sucesso: true, dados: { tipo: 'Devolução', coletor: sit.coletor, nome: func.nome, desde: agora } };
  }

  async function coletorAssumir(p) {
    const func = await buscarFuncionario(p.codfun);
    if (!func) return erro(MSG_FUNC, ERRO_FUNC);
    const sit = await situacaoColetor(p.coletor);
    if (!sit.existe) return erro('Coletor não cadastrado. Peça ajuda ao responsável.', { motivo: 'coletor_nao_encontrado' });
    if (sit.na_base) return coletorRegistrar({ coletor: p.coletor, codfun: p.codfun, movimento: 'retirada' });
    if (cod(sit.cod_fun) === cod(func.codFun)) {
      return { sucesso: true, dados: { coletor: sit.coletor, nome: func.nome, desde: sit.desde, ja_era_seu: true } };
    }

    const agora = new Date();
    const dev = agora.toISOString();
    const ret = new Date(agora.getTime() + 1000).toISOString(); // mantem a ordem Devolucao -> Retirada
    const desc = `Coletor assumido. Responsável anterior: ${sit.nome} (${sit.cod_fun || '-'}). Devolução e retirada automáticas`;
    // changes() encadeado: cada passo so grava se o anterior gravou
    const r = await DB.transacao([
      ['UPDATE coletores SET responsavel = ?, desde = ?, alerta_6h_em = NULL WHERE coletor = ? AND responsavel = ?',
        [func.codFun, ret, sit.coletor, sit.cod_fun]],
      [`INSERT INTO coletores_log (data_hora, coletor, codigo_func, nome, acao, origem)
        SELECT ?, ?, ?, ?, 'Devolução', 'assumido' WHERE changes() > 0`, [dev, sit.coletor, sit.cod_fun, sit.nome]],
      [`INSERT INTO coletores_log (data_hora, coletor, codigo_func, nome, acao, origem)
        SELECT ?, ?, ?, ?, 'Retirada', 'assumido' WHERE changes() > 0`, [ret, sit.coletor, func.codFun, func.nome]],
      [`INSERT INTO ocorrencias (data_hora, coletor, codigo_func, nome, tipo, descricao)
        SELECT ?, ?, ?, ?, 'assumido', ? WHERE changes() > 0`, [dev, sit.coletor, func.codFun, func.nome, desc]]
    ]);
    if (!r[0].alteradas) return erro('A situação do coletor mudou. Tente entrar de novo.', { motivo: 'mudou' });
    return { sucesso: true, dados: { coletor: sit.coletor, nome: func.nome, desde: ret, anterior: { cod_fun: sit.cod_fun, nome: sit.nome } } };
  }

  function tipoOcorrencia(descricao) {
    if (/leituras erradas seguidas/i.test(descricao)) return 'limite_tentativas';
    if (/^Leitura errada/i.test(descricao)) return 'leitura_errada';
    return 'outro';
  }

  async function coletorEvento(p) {
    const descricao = String(p.descricao || '').trim().slice(0, 300);
    if (!descricao) return erro('Descrição vazia.');
    await DB.executar(`
      INSERT INTO ocorrencias (data_hora, coletor, codigo_func, nome, tipo, descricao)
      VALUES (?, ?, ?, (SELECT nome FROM funcionarios WHERE codigo = ?), ?, ?)`,
      [agoraISO(), String(p.coletor || '-').trim(), cod(p.codfun), cod(p.codfun), tipoOcorrencia(descricao), descricao]);
    return { sucesso: true };
  }

  async function coletorLista() {
    const r = await DB.query('SELECT coletor, cod_fun, nome, desde FROM vw_coletores_situacao WHERE na_base = 0 AND ativo = 1');
    return { sucesso: true, dados: r };
  }

  // ============================ ADM ============================

  async function admColetores() {
    const r = await DB.query('SELECT coletor, cod_fun, nome, desde, na_base, minutos_fora FROM vw_coletores_situacao WHERE ativo = 1 ORDER BY coletor');
    return { sucesso: true, dados: r };
  }

  async function admOcorrencias(p) {
    const { ini, fim } = intervalo(p.data_inicio, p.data_fim);
    const r = await DB.query(`SELECT data_hora, coletor, codigo_func, nome, tipo, descricao FROM ocorrencias
      WHERE data_hora >= ? AND data_hora < ? ORDER BY data_hora DESC LIMIT 1000`, [ini, fim]);
    return { sucesso: true, dados: r };
  }

  // Linhas da exportacao (mesmas colunas do Exportacao.gs, com as correcoes pedidas)
  async function admExportacao(p) {
    if (!p.data_inicio || !p.data_fim) return erro('Informe a data inicial e a final.');
    const { ini, fim } = intervalo(p.data_inicio, p.data_fim);
    const r = await DB.query(`SELECT nome_tarefa, nome_funcionario, data_inicio, duracao_dias, qtd_itens
      FROM vw_exportacao WHERE data_inicio >= ? AND data_inicio < ? ORDER BY data_inicio`, [ini, fim]);
    return { sucesso: true, dados: r };
  }

  // ============================ Rotinas agendadas ============================

  async function rotinaColetores6h() {
    const limite = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const atrasados = await DB.query(`
      SELECT c.coletor, c.responsavel, c.desde, f.nome FROM coletores c
      LEFT JOIN funcionarios f ON f.codigo = c.responsavel
      WHERE c.responsavel IS NOT NULL AND c.desde < ? AND c.alerta_6h_em IS NULL`, [limite]);
    for (const c of atrasados) {
      const p = partesSP(new Date(c.desde));
      const desc = `Coletor não devolvido há mais de 6h | Retirada em: ${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
      const agora = agoraISO();
      await DB.transacao([
        ['UPDATE coletores SET alerta_6h_em = ? WHERE coletor = ? AND desde = ? AND alerta_6h_em IS NULL', [agora, c.coletor, c.desde]],
        [`INSERT INTO ocorrencias (data_hora, coletor, codigo_func, nome, tipo, descricao)
          SELECT ?, ?, ?, ?, 'atraso_6h', ? WHERE changes() > 0`, [agora, c.coletor, c.responsavel, c.nome, desc]]
      ]);
    }
    return atrasados.length;
  }

  async function rotinaLimpeza() {
    const sete = new Date(Date.now() - 7 * 86400000).toISOString();
    const q45 = new Date(Date.now() - 45 * 86400000).toISOString();
    const r = await DB.transacao([
      ['DELETE FROM coletores_log WHERE data_hora < ?', [sete]],
      ['DELETE FROM ocorrencias WHERE data_hora < ?', [q45]]
    ]);
    return { log_coletores: r[0].alteradas, ocorrencias: r[1].alteradas };
  }

  // ============================ Despacho ============================

  const ACOES = {
    versao: async () => ({ sucesso: true, dados: { versao_backend: VERSAO } }),
    verificar_cracha: verificarCracha,
    login,
    listar_tarefas: listarTarefas,
    status_funcionario: statusFuncionario,
    iniciar_tarefa: iniciarTarefa,
    finalizar_tarefa: finalizarTarefa,
    registrar_carga: registrarCarga,
    workers_carga: workersCarga,
    distribuicao_carga: distribuicaoCarga,
    verificar_doca: verificarDoca,
    painel_gestor: painelGestor,
    historico,
    registrar_alerta: registrarAlerta,
    listar_alertas: listarAlertas,
    raiox,
    cadastrar_funcionario: cadastrarFuncionario,
    cadastrar_tarefa: cadastrarTarefa,
    coletor_status: coletorStatus,
    coletor_registrar: coletorRegistrar,
    coletor_assumir: coletorAssumir,
    coletor_evento: coletorEvento,
    coletor_lista: coletorLista,
    adm_coletores: admColetores,
    adm_ocorrencias: admOcorrencias,
    adm_exportacao: admExportacao
  };

  const Backend = {
    VERSAO,
    async executar(params) {
      const p = params || {};
      const fn = ACOES[p.acao];
      if (!fn) return erro('Ação desconhecida: ' + p.acao);
      try {
        return await fn(p);
      } catch (e) {
        if (e && e.codigo === 'REDE') return erro(e.message);
        return erro('Erro: ' + ((e && e.message) || e));
      }
    },
    aplicarTimeouts, rotinaColetores6h, rotinaLimpeza, calcularDistribuicao,
    util: { diaSP, inicioDiaUTC, intervalo, carimboSP, partesSP }
  };

  raiz.Backend = Backend;
  if (typeof module !== 'undefined' && module.exports) module.exports = Backend;
})(typeof window !== 'undefined' ? window : globalThis);
