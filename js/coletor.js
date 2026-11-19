// coletor.js - Retirada e devolucao do coletor dentro do app Tarefas
//
// Desde a v11 os registros ficam no banco Turso (tabelas coletores, coletores_log
// e ocorrencias), pelas acoes coletor_* do js/backend.js.
//
// Regras (aprovadas na simulacao de telas):
// - Cada aparelho e vinculado UMA vez a um coletor, lendo o QR "COLETOR:<nome>".
//   O vinculo fica no localStorage (nao expira; so some se os dados do Chrome forem apagados).
// - Coletor na Base: so o botao "Retirar" funciona; o resto do app fica bloqueado.
// - Coletor com outra pessoa: se ela tem tarefa aberta, aviso de 10s e logout;
//   senao pergunta "Deseja assumir?" (Sim = devolucao para ela + retirada para quem entrou).
// - Devolucao so sem tarefa em andamento; depois dela, logout.
// - Leitura errada: mensagem na caixa, anota no registro_diario; na 3a seguida, tela amarela.
// - Gestor em aparelho sem vinculo (computador) entra sem coletor.

const Coletor = {
  CHAVE_VINCULO: 'coletor_vinculado',
  CHAVE_FLASH: 'coletor_flash',

  sit: null,        // situacao atual do coletor (resposta de ?api=status)
  ctx: null,        // { codigo, nome, onLiberado }
  _leitura: null,   // estado da caixa de leitura aberta
  _cacheLista: null,

  // ================= Vinculo do aparelho =================

  obterVinculo() {
    try { return localStorage.getItem(this.CHAVE_VINCULO) || ''; } catch (e) { return ''; }
  },

  salvarVinculo(nome) {
    try { localStorage.setItem(this.CHAVE_VINCULO, nome); } catch (e) {}
    // Pede ao navegador para nao apagar estes dados quando faltar espaco
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) {}
  },

  // ================= Classificacao do QR lido =================

  _norm(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  },

  // Mesma regra do sistema de coletores: retirada / devolucao, com ou sem acento, qualquer caixa
  classificarQR(texto) {
    const t = this._norm(texto);
    if (!t) return 'vazio';
    if (t === 'retirada') return 'retirada';
    if (t === 'devolucao') return 'devolucao';
    if (/^coletor\s*:/.test(t)) return 'config';
    return 'outro';
  },

  nomeDoQRConfig(texto) {
    const m = String(texto || '').match(/^\s*coletor\s*:\s*(.+?)\s*$/i);
    return m ? m[1] : '';
  },

  // ================= API (Ger_Gestao_Coletores) =================

  async _api(params) {
    const p = Object.assign({}, params);
    if (p.acao !== undefined) p.movimento = p.acao;   // retirada | devolucao
    p.acao = 'coletor_' + p.api;
    delete p.api;
    return await Backend.executar(p);
  },

  _nonce() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  status(coletor) {
    return this._api({ api: 'status', coletor });
  },

  registrar(coletor, codfun, acao) {
    return this._api({ api: 'registrar', coletor, codfun, acao, nonce: this._nonce() });
  },

  assumir(coletor, codfun) {
    return this._api({ api: 'assumir', coletor, codfun, nonce: this._nonce() });
  },

  // Anota no registro_diario sem travar a tela
  evento(coletor, codfun, descricao) {
    this._api({ api: 'evento', coletor, codfun, descricao }).catch(() => {});
  },

  // Mapa codigo do funcionario -> coletor em uso (Tempo Real do gestor). Cache de 25s.
  async mapaEmUso() {
    if (this._cacheLista && Date.now() - this._cacheLista.ts < 25000) return this._cacheLista.mapa;
    const r = await this._api({ api: 'lista' });
    const mapa = {};
    if (r && r.sucesso && Array.isArray(r.dados)) {
      r.dados.forEach(c => {
        if (c.cod_fun) mapa[String(c.cod_fun).trim().toUpperCase()] = c;
      });
      this._cacheLista = { ts: Date.now(), mapa };
    }
    return mapa;
  },

  // ================= Utilitarios de tela =================

  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  _hora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },

  _mesmo(a, b) {
    return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase() && String(a || '').trim() !== '';
  },

  _icone(tipo) {
    if (tipo === 'ok') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.2 13.6 6.3-6.3-1.4-1.4-4.9 4.9-2.3-2.3-1.4 1.4 3.7 3.7z"/></svg>';
    }
    if (tipo === 'qr') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm11-2h2v2h-2v-2zm-3 0h2v2h-2v-2zm3 3h2v2h-2v-2zm3-3h2v2h-2v-2zm0 3h2v5h-5v-2h3v-3zm-6 2h2v3h-2v-3z"/></svg>';
    }
    if (tipo === 'aparelho') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v12h10V5H7zm4 14v1h2v-1h-2z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm-1 7h2v6h-2V9zm0 8h2v2h-2v-2z"/></svg>';
  },

  // Quadro com o coletor e a situacao dele
  htmlChip(sit, codigoLogado) {
    if (!sit) {
      return `<div class="coletor-chip nenhum"><span class="coletor-chip-nome">${this._icone('aparelho')}Coletor não vinculado</span></div>`;
    }
    const nome = this._esc(sit.coletor);
    if (sit.indisponivel) {
      return `<div class="coletor-chip nenhum"><span class="coletor-chip-nome">${nome}</span><span class="coletor-chip-tag">Situação indisponível</span></div>`;
    }
    if (sit.na_base) {
      return `<div class="coletor-chip base"><span class="coletor-chip-nome"><i class="coletor-dot amarelo"></i>${nome}</span><span class="coletor-chip-tag">Na base</span></div>`;
    }
    if (codigoLogado && this._mesmo(sit.cod_fun, codigoLogado)) {
      const h = this._hora(sit.desde);
      return `<div class="coletor-chip meu"><span class="coletor-chip-nome"><i class="coletor-dot verde"></i>${nome}</span><span class="coletor-chip-tag">${h ? 'Com você desde ' + h : 'Com você'}</span></div>`;
    }
    return `<div class="coletor-chip outro"><span class="coletor-chip-nome"><i class="coletor-dot cinza"></i>${nome}</span><span class="coletor-chip-tag">Com ${this._esc(sit.nome)}</span></div>`;
  },

  // Tela cheia (aviso vermelho 10s, devolucao verde 3s, limite de tentativas amarelo)
  telaCheia({ cor, icone, titulo, texto, segundos, botao }) {
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.className = `coletor-tela ${cor}`;
      div.setAttribute('role', 'alert');
      div.innerHTML = `
        <div class="coletor-tela-icone">${this._icone(icone)}</div>
        <div class="coletor-tela-titulo">${titulo}</div>
        ${texto ? `<div class="coletor-tela-texto">${texto}</div>` : ''}
        ${segundos ? `<div class="coletor-tela-contador">${segundos}</div>` : ''}
        ${botao ? `<button class="btn coletor-tela-botao">${this._esc(botao)}</button>` : ''}
      `;
      document.body.appendChild(div);

      let fim = false;
      const fechar = () => {
        if (fim) return;
        fim = true;
        clearInterval(timer);
        div.remove();
        resolve();
      };

      let timer = null;
      if (segundos) {
        let resta = segundos;
        const cont = div.querySelector('.coletor-tela-contador');
        timer = setInterval(() => {
          resta--;
          if (cont) cont.textContent = Math.max(resta, 0);
          if (resta <= 0) fechar();
        }, 1000);
      }
      const btn = div.querySelector('.coletor-tela-botao');
      if (btn) {
        btn.addEventListener('click', fechar);
        btn.focus();
      }
    });
  },

  // Caixa simples com um ou dois botoes
  _caixa({ icone, corIcone, titulo, texto, botoes }) {
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.className = 'modal-overlay visivel coletor-modal';
      div.innerHTML = `
        <div class="modal coletor-caixa">
          ${icone ? `<div class="coletor-caixa-icone ${corIcone || ''}">${this._icone(icone)}</div>` : ''}
          <div class="modal-title">${this._esc(titulo)}</div>
          <p class="coletor-caixa-texto">${texto}</p>
          <div class="coletor-caixa-botoes">
            ${botoes.map((b, i) => `<button class="btn ${b.classe}" data-i="${i}">${this._esc(b.texto)}</button>`).join('')}
          </div>
        </div>`;
      document.body.appendChild(div);
      div.querySelectorAll('button[data-i]').forEach(b => {
        b.addEventListener('click', () => {
          div.remove();
          resolve(botoes[parseInt(b.dataset.i, 10)].valor);
        });
      });
    });
  },

  aviso(titulo, texto, corIcone) {
    return this._caixa({
      icone: 'alerta', corIcone: corIcone || 'vermelho', titulo, texto,
      botoes: [{ texto: 'Entendi', classe: 'btn-primary', valor: true }]
    });
  },

  perguntarAssumir(nomeResponsavel) {
    return this._caixa({
      icone: 'alerta', corIcone: 'amarelo', titulo: 'Coletor em uso',
      texto: `<b>${this._esc(nomeResponsavel)}</b> é responsável por este coletor.<br>Deseja assumir?`,
      botoes: [
        { texto: 'Não', classe: 'btn-secondary', valor: false },
        { texto: 'Sim', classe: 'btn-success', valor: true }
      ]
    });
  },

  // ================= Login =================

  // Chamado pelo Auth.login depois que o cracha foi aceito.
  // Retorna { liberado: true } ou { liberado: false, mensagem }.
  async verificarAposLogin(func) {
    const vinculo = this.obterVinculo();
    if (!vinculo) {
      if (func.perfil === 'gestor' || func.perfil === 'adm') return { liberado: true }; // gestor/ADM no computador
      return {
        liberado: false,
        mensagem: 'Este aparelho ainda não foi vinculado a um coletor. Chame o responsável para ler o QR de configuração.'
      };
    }

    const st = await this.status(vinculo);
    if (!st || !st.sucesso) {
      return {
        liberado: false,
        mensagem: (st && st.motivo === 'coletor_nao_encontrado')
          ? st.mensagem
          : 'Não foi possível consultar o coletor. Tente novamente.'
      };
    }

    const sit = st.dados;
    if (sit.na_base || this._mesmo(sit.cod_fun, func.codigo)) return { liberado: true };

    // Coletor com outra pessoa: ela esta executando tarefa?
    if (sit.cod_fun) {
      const t = await API.get({ acao: 'status_funcionario', codigo: sit.cod_fun });
      if (!t || !t.sucesso) {
        return { liberado: false, mensagem: 'Não foi possível verificar o responsável pelo coletor. Tente novamente.' };
      }
      if (t.dados && t.dados.tarefa_ativa) {
        await this.telaCheia({
          cor: 'vermelho', icone: 'alerta',
          titulo: `${this._esc(sit.nome)} é responsável por este coletor e está executando tarefas!`,
          texto: 'Você será desconectado.',
          segundos: CONFIG.COLETOR_AVISO_BLOQUEIO_S
        });
        return { liberado: false };
      }
    }

    const assumir = await this.perguntarAssumir(sit.nome);
    if (!assumir) return { liberado: false };

    const a = await this.assumir(vinculo, func.codigo);
    if (!a || !a.sucesso) {
      return { liberado: false, mensagem: (a && a.mensagem) || 'Não foi possível assumir o coletor.' };
    }
    try {
      const msg = a.dados && a.dados.anterior
        ? `Coletor assumido. Devolução registrada para ${a.dados.anterior.nome} e retirada para você.`
        : 'Retirada registrada.';
      sessionStorage.setItem(this.CHAVE_FLASH, msg);
    } catch (e) {}
    return { liberado: true };
  },

  // Bloco do coletor na tela de login (vinculo + quadro de situacao)
  async prepararLogin(containerId, opcoes) {
    const el = document.getElementById(containerId);
    if (!el) return;
    this._loginEl = el;
    this._loginOpcoes = opcoes || {};
    const vinculo = this.obterVinculo();

    if (!vinculo) {
      el.innerHTML = `
        ${this.htmlChip(null)}
        <div class="msg msg-warning coletor-login-msg">Este aparelho ainda não foi identificado. Chame o responsável para ler o QR de configuração do coletor.</div>
        <div class="coletor-scan-box">
          <div class="coletor-scan-icone">${this._icone('qr')}</div>
          <input type="text" id="coletor-vinculo-input" class="input-text" placeholder="Leia o QR do coletor" autocomplete="off">
          <div class="coletor-hint">Formato: COLETOR:07</div>
        </div>
        <div class="coletor-hint">Gestor no computador: entre com o crachá abaixo.</div>`;
      const input = document.getElementById('coletor-vinculo-input');
      input.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const v = input.value;
        input.value = '';
        this.vincular(v);
      });
      // So puxa o cursor se ninguem estiver digitando em outro campo
      setTimeout(() => {
        const ativo = document.activeElement;
        if (!ativo || ativo === document.body) input.focus();
      }, 50);
      return;
    }

    el.innerHTML = this.htmlChip({ coletor: vinculo, indisponivel: true });
    const st = await this.status(vinculo);
    if (st && st.sucesso) {
      this.sit = st.dados;
      el.innerHTML = this.htmlChip(st.dados);
    }
  },

  // Le o QR "COLETOR:<nome>" e grava o vinculo do aparelho
  async vincular(texto) {
    const el = this._loginEl;
    const avisar = (html, tipo) => {
      if (!el) return;
      let m = el.querySelector('.coletor-login-msg');
      if (!m) {
        m = document.createElement('div');
        el.prepend(m);
      }
      m.className = `msg msg-${tipo} coletor-login-msg`;
      m.innerHTML = html;
    };

    if (this.classificarQR(texto) !== 'config') {
      avisar('<b>Este não é o QR de configuração do coletor.</b><br>O QR de configuração começa com COLETOR:', 'error');
      return false;
    }
    const nome = this.nomeDoQRConfig(texto);
    avisar('Verificando coletor...', 'info');
    const st = await this.status(nome);
    if (!st || !st.sucesso) {
      avisar(this._esc((st && st.mensagem) || 'Não foi possível verificar o coletor.'), 'error');
      return false;
    }
    this.salvarVinculo(st.dados.coletor);
    this.sit = st.dados;
    if (el) {
      el.innerHTML = `<div class="msg msg-success coletor-login-msg"><b>Aparelho vinculado: ${this._esc(st.dados.coletor)}</b><br>Pronto para uso.</div>${this.htmlChip(st.dados)}`;
    }
    if (this._loginOpcoes && this._loginOpcoes.aposVincular) this._loginOpcoes.aposVincular();
    return true;
  },

  // ================= Painel (funcionario e gestor) =================

  // ctx: { onLiberado: fn chamada quando o coletor passa a ser do usuario }
  async prepararPainel(ctx) {
    const func = Auth.obterSessao();
    if (!func) return;
    this.ctx = Object.assign({ codigo: func.codigo, nome: func.nome }, ctx || {});
    const vinculo = this.obterVinculo();
    if (!vinculo) return; // gestor no computador: sem controle de coletor
    this.coletor = vinculo;

    const container = document.querySelector('.container');
    if (!container) return;

    // Marca o conteudo do painel como "protegido" (fica apagado quando bloqueado)
    Array.from(container.children).forEach(filho => {
      if (filho.id !== 'msg') filho.classList.add('coletor-protegido');
    });

    this._area = document.createElement('div');
    this._area.className = 'coletor-area';
    this._rodape = document.createElement('div');
    this._rodape.className = 'coletor-rodape';
    const msg = document.getElementById('msg');
    if (msg && msg.parentNode === container) msg.after(this._area);
    else container.prepend(this._area);
    container.appendChild(this._rodape);

    this._bloquear(true);
    this._area.innerHTML = this.htmlChip({ coletor: vinculo, indisponivel: true });

    await this.recarregarSituacao();

    try {
      const flash = sessionStorage.getItem(this.CHAVE_FLASH);
      if (flash) {
        sessionStorage.removeItem(this.CHAVE_FLASH);
        this._mensagem(flash, 'success');
      }
    } catch (e) {}
  },

  async recarregarSituacao() {
    const st = await this.status(this.coletor);
    if (!st || !st.sucesso) {
      this._area.innerHTML = `
        ${this.htmlChip({ coletor: this.coletor, indisponivel: true })}
        <div class="msg msg-error">${this._esc((st && st.mensagem) || 'Não foi possível consultar o coletor.')}</div>
        <button class="btn btn-primary" id="coletor-btn-tentar">Tentar de novo</button>`;
      document.getElementById('coletor-btn-tentar').addEventListener('click', () => this.recarregarSituacao());
      this._bloquear(true);
      return;
    }
    this.sit = st.dados;
    this._renderPainel();
  },

  _renderPainel() {
    const sit = this.sit;
    const meu = !sit.na_base && this._mesmo(sit.cod_fun, this.ctx.codigo);

    if (sit.na_base) {
      this._area.innerHTML = `
        ${this.htmlChip(sit, this.ctx.codigo)}
        <div class="msg msg-warning">Registre a retirada do coletor para liberar as tarefas.</div>
        <button class="btn btn-success btn-lg coletor-btn-retirar" id="coletor-btn-retirar">${this._icone('qr')}Retirar</button>`;
      document.getElementById('coletor-btn-retirar').addEventListener('click', () => this.retirar());
      this._rodape.innerHTML = '<div class="coletor-hint">Tarefas bloqueadas</div>';
      this._bloquear(true);
      return;
    }

    if (meu) {
      this._area.innerHTML = this.htmlChip(sit, this.ctx.codigo);
      this._rodape.innerHTML = `<button class="btn btn-outline coletor-btn-devolver" id="coletor-btn-devolver">${this._icone('qr')}Devolver</button>`;
      document.getElementById('coletor-btn-devolver').addEventListener('click', () => this.devolver());
      this._bloquear(false);
      return;
    }

    // Coletor ficou com outra pessoa enquanto esta sessao estava aberta
    this._area.innerHTML = `
      ${this.htmlChip(sit, this.ctx.codigo)}
      <div class="msg msg-error">Este coletor agora está com ${this._esc(sit.nome)}.</div>
      <button class="btn btn-secondary" id="coletor-btn-sair">Sair</button>`;
    document.getElementById('coletor-btn-sair').addEventListener('click', () => Auth.logout());
    this._rodape.innerHTML = '';
    this._bloquear(true);
  },

  _bloquear(sim) {
    document.body.classList.toggle('coletor-bloqueado', !!sim);
  },

  _mensagem(texto, tipo) {
    const el = document.getElementById('msg');
    if (!el) return;
    el.textContent = texto;
    el.className = `msg msg-${tipo}`;
    setTimeout(() => el.classList.add('hidden'), 6000);
  },

  // ================= Caixa de leitura do QR da estacao =================

  // modo: 'retirada' | 'devolucao'. Resolve 'lido' (QR certo; caixa fica aberta
  // em "Registrando..."), 'cancelado' ou 'limite' (3 leituras erradas).
  _lerQR(modo) {
    return new Promise(resolve => {
      const acaoTxt = modo === 'retirada' ? 'RETIRAR' : 'DEVOLVER';
      const esperado = modo === 'retirada' ? 'RETIRADA' : 'DEVOLUÇÃO';
      const max = CONFIG.COLETOR_TENTATIVAS_MAX;

      const div = document.createElement('div');
      div.className = 'modal-overlay visivel coletor-modal';
      div.innerHTML = `
        <div class="modal coletor-caixa">
          <div class="modal-title">${modo === 'retirada' ? 'Retirar coletor' : 'Devolver coletor'}</div>
          <div class="msg msg-error coletor-leitura-erro hidden"></div>
          <div class="coletor-scan-box">
            <div class="coletor-scan-icone">${this._icone('qr')}</div>
            <input type="text" class="input-text coletor-leitura-input" placeholder="Leia o QR da estação" autocomplete="off">
            <div class="coletor-hint">Leia o QR de ${esperado}</div>
          </div>
          <div class="coletor-hint coletor-leitura-registrando hidden">Registrando...</div>
          <button class="btn btn-secondary coletor-leitura-cancelar">Cancelar</button>
        </div>`;
      document.body.appendChild(div);

      const input = div.querySelector('.coletor-leitura-input');
      const erro = div.querySelector('.coletor-leitura-erro');
      let tentativas = 0;
      let terminado = false;

      const fechar = () => div.remove();
      this._leitura = { fechar };
      const focar = () => { if (!terminado) input.focus(); };
      setTimeout(focar, 50);
      div.addEventListener('click', ev => { if (ev.target.tagName !== 'BUTTON') focar(); });

      div.querySelector('.coletor-leitura-cancelar').addEventListener('click', () => {
        if (terminado) return;
        terminado = true;
        fechar();
        resolve('cancelado');
      });

      input.addEventListener('keydown', async ev => {
        if (ev.key !== 'Enter' || terminado) return;
        ev.preventDefault();
        const lido = input.value;
        input.value = '';
        const tipo = this.classificarQR(lido);
        if (tipo === 'vazio') return;

        if (tipo === modo) {
          terminado = true;
          input.disabled = true;
          erro.classList.add('hidden');
          div.querySelector('.coletor-leitura-registrando').classList.remove('hidden');
          div.querySelector('.coletor-leitura-cancelar').disabled = true;
          resolve('lido');
          return;
        }

        // Leitura errada
        tentativas++;
        let html, descricao;
        if (tipo === 'retirada' || tipo === 'devolucao') {
          const lidoTxt = tipo === 'retirada' ? 'RETIRADA' : 'DEVOLUÇÃO';
          descricao = `Leitura errada ao ${acaoTxt} (${tentativas}/${max}): leu QR de ${lidoTxt}`;
          html = modo === 'retirada'
            ? '<b>Este é o QR de DEVOLUÇÃO.</b><br>Para retirar, leia o QR de RETIRADA.'
            : `<b>Este é o QR de RETIRADA.</b><br>O ${this._esc(this.coletor)} já está com você. Para devolver, leia o QR de DEVOLUÇÃO.`;
        } else {
          const conteudo = String(lido).trim().slice(0, 60);
          descricao = `Leitura errada ao ${acaoTxt} (${tentativas}/${max}): QR não reconhecido, conteúdo lido "${conteudo}"`;
          html = `<b>QR não reconhecido.</b><br>Leia o QR de ${esperado} que fica na base dos coletores.`;
        }
        this.evento(this.coletor, this.ctx.codigo, descricao);

        if (tentativas >= max) {
          terminado = true;
          this.evento(this.coletor, this.ctx.codigo,
            `${max} leituras erradas seguidas ao ${acaoTxt}. Orientado a chamar o responsável`);
          fechar();
          await this.telaCheia({
            cor: 'amarelo', icone: 'alerta',
            titulo: `${max} leituras erradas seguidas`,
            texto: 'Chame o responsável para ajudar com o coletor.',
            botao: 'Voltar'
          });
          resolve('limite');
          return;
        }

        erro.innerHTML = `${html}<br><span class="coletor-tentativa">Tentativa ${tentativas} de ${max}</span>`;
        erro.classList.remove('hidden');
        focar();
      });
    });
  },

  _fecharLeitura() {
    if (this._leitura) {
      this._leitura.fechar();
      this._leitura = null;
    }
  },

  // ================= Retirar / Devolver =================

  async retirar() {
    const r = await this._lerQR('retirada');
    if (r !== 'lido') return;

    const resp = await this.registrar(this.coletor, this.ctx.codigo, 'retirada');
    this._fecharLeitura();

    if (resp && resp.sucesso) {
      this.sit = {
        existe: true, coletor: this.coletor, na_base: false,
        cod_fun: this.ctx.codigo, nome: this.ctx.nome,
        desde: (resp.dados && resp.dados.desde) || new Date().toISOString()
      };
      this._renderPainel();
      this._mensagem(`Retirada registrada. ${this.coletor} está com você.`, 'success');
      if (this.ctx.onLiberado) this.ctx.onLiberado();
      return;
    }

    await this.aviso('Não foi possível registrar', this._esc((resp && resp.mensagem) || 'Tente novamente.'));
    await this.recarregarSituacao();
  },

  async devolver() {
    const r = await this._lerQR('devolucao');
    if (r !== 'lido') return;

    // Devolucao so sem tarefa em andamento
    const t = await API.get({ acao: 'status_funcionario', codigo: this.ctx.codigo });
    if (!t || !t.sucesso) {
      this._fecharLeitura();
      await this.aviso('Sem conexão', this._esc((t && t.mensagem) || 'Tente novamente.'));
      return;
    }
    if (t.dados && t.dados.tarefa_ativa) {
      this._fecharLeitura();
      await this.aviso('Devolução não permitida',
        `Você tem a tarefa <b>${this._esc(t.dados.tarefa_ativa.nome_tarefa)}</b> em andamento. Finalize a tarefa antes de devolver o coletor.`);
      return;
    }

    const resp = await this.registrar(this.coletor, this.ctx.codigo, 'devolucao');
    this._fecharLeitura();

    if (resp && resp.sucesso) {
      const hora = this._hora(new Date().toISOString());
      await this.telaCheia({
        cor: 'verde', icone: 'ok',
        titulo: 'Coletor devolvido',
        texto: `${this._esc(this.coletor)} registrado na base às ${hora}.<br>Saindo do app...`,
        segundos: CONFIG.COLETOR_CONFIRMA_DEVOLUCAO_S
      });
      Auth.logout();
      return;
    }

    await this.aviso('Não foi possível registrar', this._esc((resp && resp.mensagem) || 'Tente novamente.'));
    await this.recarregarSituacao();
  }
};
