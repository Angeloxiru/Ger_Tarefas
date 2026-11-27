#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GERADOR PADRÃO DO RELATÓRIO DE PERFORMANCE MENSAL (Bonificação Logística)
Versão 1.2 (25/11/2026): layout para impressão em preto e branco em 1 folha (frente e verso),
comparação com o mês anterior, conflitos e timeouts só em totais no PDF, anomalias e WMS sem vínculo
só no resumo da conversa, ajuste do Recebimento (mínimo de 2 min) aplicado mas não exibido.

NÃO ALTERAR cálculos, cores, colunas ou textos deste arquivo sem pedido da gerência.
Qualquer mudança aprovada deve ser feita aqui e também em 2_regras_de_calculo.md,
4_modelo_relatorio_pdf.md e 6_padrao_relatorio_performance.md, com nova versão no cabeçalho.

Uso:
    python3 7_gerador_relatorio_performance.py entrada.json [pasta_saida]

Dependências: reportlab, matplotlib (pip install reportlab matplotlib --break-system-packages)

Formato do entrada.json (montado a partir das consultas padrão do arquivo 6):
{
  "cracha": "PL16",
  "nome": "Nome Completo do Funcionário",      # funcionarios.nome_completo
  "mes_txt": "Novembro/2026",                  # ou "Novembro/2026 (parcial: 01 a 24/11)"
  "aaaamm": "2026-11",
  "periodo_txt": "novembro/2026",
  "parcial": "",                               # texto da faixa de aviso; vazio = mês completo
  "periodo_ini": "2026-11-01",                 # primeiro dia do período (Brasília)
  "periodo_fim": "2026-12-01",                 # dia seguinte ao último dia do período (Brasília, exclusivo)
  "gerado": "01/12/2026",
  "wms_sem_vinculo": 0,                        # resultado da consulta Q6 (só no resumo da conversa)
  "app":  {"columns": [...], "rows": [...]},   # resultado da consulta Q3 (colunas por nome)
  "wms":  {"columns": [...], "rows": [...]},   # resultado da consulta Q4 (período com margem de 1 dia antes e depois)
  "alertas": {"columns": [...], "rows": [...]},# resultado da consulta Q5
  "anterior": {                                # mês anterior completo (consultas Q3A, Q4A, Q5A); omitir se não houver
    "mes_txt": "Outubro/2026", "periodo_ini": "2026-10-01", "periodo_fim": "2026-11-01",
    "app": {...}, "wms": {...}, "alertas": {...}
  },
  "ajustes_gerencia": []                       # opcional: textos de ajustes informados na conversa
                                               # (só aparecem no resumo do chat, não no PDF)
}
Colunas exigidas (também no bloco "anterior"):
  app:     id_registro, nome_tarefa, status, ini, fim, seg, vol   (cf é calculado aqui; se vier, é ignorado)
  wms:     numero, tarefa, ini, fim, execucao_seg, qtde_itens
  alertas: data_br, descricao, emissor
"""
import json, os, sys, collections, datetime as dt

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, CondPageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ======================= PARÂMETROS DAS REGRAS (2_regras_de_calculo.md) =======================
METAS = {  # função: (meta, unidade, tipo) | tipo "vol" = soma de volumes; "pal" = quantidade de tarefas
    "Carregamento":           (220, "vol/h", "vol"),
    "Separação Manual":       (220, "vol/h", "vol"),
    "Separação Empilhadeira": (12, "pallets/h", "pal"),
    "Realocação de estoque":  (12, "pallets/h", "pal"),
    "Armazenagem":            (20, "pallets/h", "pal"),
    "Recebimento":            (24, "pallets/h", "pal"),
}
N1_MIN_SEG = 100 * 3600          # N1: horas válidas >= 100h
N2_MIN_SEG_FUNCAO = 3 * 3600     # N2: função com meta entra com 3h ou mais
N3_MAX_ALERTAS = 3               # N3: menos de 3 alertas
RECEB_MIN_SEG = 120              # Recebimento < 2 min conta como 2 min (só tempo)
CONFLITO_MIN_SEG = 300           # conflito: sobreposição app x WMS maior que 5 minutos
MARGEM_SEG = 24 * 3600           # margem da consulta Q4; nenhuma tarefa do WMS pode durar isso ou mais
# ===============================================================================================

def _fonte():
    cands = [("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")]
    try:
        import matplotlib.font_manager as fm
        base = os.path.dirname(fm.findfont("DejaVu Sans"))
        cands.append((os.path.join(base, "DejaVuSans.ttf"), os.path.join(base, "DejaVuSans-Bold.ttf")))
    except Exception:
        pass
    for reg, bold in cands:
        if os.path.exists(reg) and os.path.exists(bold):
            pdfmetrics.registerFont(TTFont("DV", reg)); pdfmetrics.registerFont(TTFont("DVB", bold)); return
    raise SystemExit("Fonte DejaVu Sans não encontrada.")

def br(x, casas=1):
    return f"{x:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")

def hm(seg):
    m = int(round(seg / 60)); return f"{m // 60}h{m % 60:02d}"

def dia_br(s):
    return dt.datetime.strptime(s[:10], "%Y-%m-%d").strftime("%d/%m")

def T(s):
    return dt.datetime.fromisoformat(s)

def linhas(bloco, campos):
    idx = {c: i for i, c in enumerate(bloco["columns"])}
    falta = [c for c in campos if c not in idx]
    if falta: raise SystemExit(f"Colunas ausentes na entrada: {falta}")
    return [[r[idx[c]] for c in campos] for r in bloco["rows"]]

def plural(n, s, p=None):
    return s if n == 1 else (p or s + "s")


def qtd(f, nt, vol):
    return vol if f in METAS and METAS[f][2] == "vol" else nt


def calcular(cfg):
    """Cálculo do mês (regras 2, 3, 8 e níveis). Usado para o mês do relatório e para o mês anterior."""
    app0 = linhas(cfg["app"], ["id_registro", "nome_tarefa", "status", "ini", "fim", "seg", "vol"])
    wms_todas = linhas(cfg["wms"], ["numero", "tarefa", "ini", "fim", "execucao_seg", "qtde_itens"])
    p_ini, p_fim = cfg["periodo_ini"], cfg["periodo_fim"]
    no_periodo = lambda s: p_ini <= s[:10] < p_fim

    # ---- Premissa da margem: nenhuma tarefa do WMS com 24h ou mais ----
    longas = [w for w in wms_todas if w[3] and (T(w[3]) - T(w[2])).total_seconds() >= MARGEM_SEG]
    if longas:
        raise SystemExit("PARADO: há tarefa do WMS com 24h ou mais (" + ", ".join(str(w[0]) for w in longas[:5]) +
                         "). A margem de 1 dia da consulta Q4 pode não bastar. Avisar a gerência antes de seguir.")

    # ---- Regra 3: conflito app x WMS (> 5 min com uma mesma tarefa do WMS), horários reais ----
    wms_ord = sorted(wms_todas, key=lambda w: w[2])
    app = []
    for rid, tar, st, ini, fim, seg, vol in sorted(app0, key=lambda r: r[3]):
        if not no_periodo(ini): continue
        cf = None
        a_i, a_f = T(ini), T(fim)
        for num, wt, wi, wf, _, _ in wms_ord:
            if not wf: continue
            w_i = T(wi)
            if w_i >= a_f: break
            w_f = T(wf)
            if w_f <= a_i: continue
            if (min(a_f, w_f) - max(a_i, w_i)).total_seconds() > CONFLITO_MIN_SEG:
                cf = str(num); break
        app.append([rid, tar, st, ini, fim, seg, vol, cf])
    wms = [w for w in wms_todas if no_periodo(w[2])]
    alertas = linhas(cfg["alertas"], ["data_br", "descricao", "emissor"])
    ALERTAS = [(dt.datetime.fromisoformat(a).strftime("%d/%m/%Y %H:%M"), (b or "").replace("\n", "; "), c) for a, b, c in alertas]

    # ---- Regra 2 (app x app): sobreposição entre tarefas válidas do app contada uma vez só ----
    validas = sorted([r for r in app if not r[7]], key=lambda r: r[3])
    ajuste, anom_app = collections.Counter(), []
    for i, a in enumerate(validas):
        for b in validas[i + 1:]:
            if T(b[3]) >= T(a[4]): continue
            sob = (min(T(a[4]), T(b[4])) - max(T(a[3]), T(b[3]))).total_seconds()
            if sob > 0:
                ajuste[a[0]] += sob          # desconta da tarefa que começou primeiro
                anom_app.append((a, b, sob))

    # ---- Agregação ----
    agg = collections.defaultdict(lambda: [0, 0, 0])          # (dia, função, origem) -> seg, n, vol
    mes = collections.defaultdict(lambda: [0, 0, 0, ""])      # função -> seg, n, vol, origem
    conflitos, timeouts, seg_conf = [], [], 0
    for rid, tar, st, ini, fim, seg, vol, cf in app:
        if cf:
            conflitos.append((rid, tar, st, ini, fim, seg, str(cf))); seg_conf += seg; continue
        s = seg - ajuste.get(rid, 0)
        if st == "timeout": timeouts.append((rid, tar, ini, fim, seg, s))
        a = agg[(ini[:10], tar, "App")]; a[0] += s; a[1] += 1; a[2] += vol or 0
        m = mes[tar]; m[0] += s; m[1] += 1; m[2] += vol or 0; m[3] = "App"

    wms_por_num = {str(w[0]): (w[1], w[2], w[3]) for w in wms_todas}
    rec_n_aj, rec_seg_add = 0, 0
    for num, tar, ini, fim, seg, itens in wms:
        if tar == "Recebimento" and seg < RECEB_MIN_SEG:
            rec_n_aj += 1; rec_seg_add += RECEB_MIN_SEG - seg; seg = RECEB_MIN_SEG
        a = agg[(ini[:10], tar, "WMS")]; a[0] += seg; a[1] += 1; a[2] += itens or 0
        m = mes[tar]; m[0] += seg; m[1] += 1; m[2] += itens or 0; m[3] = "WMS"

    anom_wms = []  # sobreposição WMS x WMS, horários reais
    ws = sorted(wms, key=lambda r: r[2])
    for i, a in enumerate(ws):
        for b in ws[i + 1:]:
            if T(b[2]) >= T(a[3]): break
            sob = (min(T(a[3]), T(b[3])) - max(T(a[2]), T(b[2]))).total_seconds()
            if sob > 0: anom_wms.append((a, b, sob))


    total_seg = sum(v[0] for v in mes.values())
    seg_app = sum(v[0] for v in mes.values() if v[3] == "App")
    seg_wms = sum(v[0] for v in mes.values() if v[3] == "WMS")

    # ---- Níveis ----
    n1 = total_seg >= N1_MIN_SEG
    avaliadas = []
    for f, (meta, un, tipo) in METAS.items():
        if f in mes and mes[f][0] >= N2_MIN_SEG_FUNCAO:
            q = qtd(f, mes[f][1], mes[f][2]); prod = q / (mes[f][0] / 3600)
            avaliadas.append((f, mes[f][0], q, prod, meta, un, prod >= meta))
    n2 = n1 and all(x[6] for x in avaliadas)
    n3 = n1 and n2 and len(ALERTAS) < N3_MAX_ALERTAS

    def status(ok, anterior=True):
        if not anterior: return "BLOQUEADO"
        return "CONQUISTADO" if ok else "NÃO CONQUISTADO"
    s1, s2, s3 = status(n1), status(n2, n1), status(n3, n1 and n2)

    return {k: v for k, v in locals().items() if k != "cfg"}


def gerar(cfg, pasta):
    _fonte()
    CRACHA, NOME, MES_TXT, GERADO = cfg["cracha"], cfg["nome"], cfg["mes_txt"], cfg["gerado"]
    PARCIAL = cfg.get("parcial", "")
    OUT = os.path.join(pasta, f"performance_{CRACHA}_{cfg['aaaamm']}.pdf")
    C = calcular(cfg)
    app, wms, ALERTAS, ajuste, anom_app, anom_wms, agg, mes, conflitos, timeouts, seg_conf, rec_n_aj, rec_seg_add, total_seg, seg_app, seg_wms, n1, n2, n3, avaliadas, s1, s2, s3, wms_por_num = (C[k] for k in "app,wms,ALERTAS,ajuste,anom_app,anom_wms,agg,mes,conflitos,timeouts,seg_conf,rec_n_aj,rec_seg_add,total_seg,seg_app,seg_wms,n1,n2,n3,avaliadas,s1,s2,s3,wms_por_num".split(","))
    ANT = calcular(cfg["anterior"]) if cfg.get("anterior") else None

    # ================= LAYOUT (impressão em preto e branco, 1 folha frente e verso) =================
    from reportlab.graphics.shapes import Drawing, Rect, Line
    from reportlab.platypus import KeepTogether

    ordem_func = sorted(mes, key=lambda f: -mes[f][0])
    dias = sorted({k[0] for k in agg})
    seg_to = sum(t[5] for t in timeouts)
    dias_conf = collections.Counter(c[3][:10] for c in conflitos)
    SEM = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]
    UN = {"vol/h": "V/h", "pallets/h": "P/h"}
    outras = [f for f in ordem_func if mes[f][0] < N2_MIN_SEG_FUNCAO]   # com ou sem meta: abaixo de 3h não conta para o N2
    vis = [f for f in ordem_func if f not in outras]
    CZ_ESC, CZ_MED, CZ_CLA = colors.HexColor("#555555"), colors.HexColor("#BBBBBB"), colors.HexColor("#EFEFEF")
    LARG = 18.6 * cm

    H1 = ParagraphStyle("h1", fontName="DVB", fontSize=12.75, leading=16)
    SUB = ParagraphStyle("sub", fontName="DV", fontSize=9.5, leading=12)
    SEC = ParagraphStyle("sec", fontName="DVB", fontSize=10.5, leading=13)
    N = ParagraphStyle("n", fontName="DV", fontSize=8.5, leading=11)
    NB = ParagraphStyle("nb", fontName="DVB", fontSize=8.5, leading=11)
    P = ParagraphStyle("p", fontName="DV", fontSize=7.5, leading=9.5)
    PC = ParagraphStyle("pc", parent=P, alignment=1)
    PCB = ParagraphStyle("pcb", fontName="DVB", fontSize=7, leading=8.5, alignment=1, textColor=colors.white)

    def secao(txt):
        t = Table([[Paragraph(txt, SEC)]], colWidths=[LARG])
        t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1.2, colors.black), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 8)]))
        return t

    def tabela(dados, larg, fs=8, alinhar_dir_de=1):
        t = Table(dados, colWidths=larg, repeatRows=1)
        st = [("FONT", (0, 0), (-1, 0), "DVB", fs), ("FONT", (0, 1), (-1, -1), "DV", fs),
              ("BACKGROUND", (0, 0), (-1, 0), colors.black), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
              ("LINEBELOW", (0, 1), (-1, -1), 0.3, CZ_MED), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
              ("ALIGN", (alinhar_dir_de, 1), (-1, -1), "RIGHT")]
        t.setStyle(TableStyle(st)); return t

    def barra(pct, w=2.4 * cm, h=0.32 * cm):
        d = Drawing(w, h); escala = 1.5
        d.add(Rect(0, 0, w, h, fillColor=colors.white, strokeColor=colors.black, strokeWidth=0.5))
        d.add(Rect(0, 0, w * min(pct, escala) / escala, h, fillColor=CZ_ESC if pct >= 1 else CZ_MED, strokeWidth=0))
        x = w / escala; d.add(Line(x, -1.5, x, h + 1.5, strokeColor=colors.black, strokeWidth=1.2))
        return d

    def rodape(c, doc):
        c.saveState(); c.setFont("DV", 7); c.setFillColor(colors.black)
        c.drawString(1.2 * cm, 0.7 * cm, f"Relatório de performance | {NOME} ({CRACHA}) | {MES_TXT}")
        TOT_PAG[0] = max(TOT_PAG[0], doc.page)
        c.drawRightString(A4[0] - 1.2 * cm, 0.7 * cm, f"Página {doc.page} de {TOT_PAG[1] or '?'}"); c.restoreState()
    TOT_PAG = [0, 0]   # [maior página vista na 1ª passagem, total usado no rodapé]

    # ---------------- FOLHA 1 ----------------
    mes_grande, _, mes_resto = MES_TXT.partition(" (")
    cab = Table([[Paragraph("Relatório de performance mensal", H1), Paragraph(f"<b>{mes_grande}</b>", ParagraphStyle("m", parent=H1, alignment=2))],
                 [Paragraph(f"<b>{NOME}</b> &nbsp;|&nbsp; Crachá {CRACHA}", SUB),
                  Paragraph((f"<b>({mes_resto}</b> &nbsp;|&nbsp; " if mes_resto else "") + f"Gerado em {GERADO}", ParagraphStyle("g", parent=SUB, alignment=2))]],
                colWidths=[10.1 * cm, 8.5 * cm])
    cab.setStyle(TableStyle([("LINEBELOW", (0, -1), (-1, -1), 2, colors.black), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, -1), (-1, -1), 5)]))
    story = [cab, Spacer(1, 6)]
    if PARCIAL:
        pt = Table([[Paragraph("⚠ " + PARCIAL, NB)]], colWidths=[LARG])
        pt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.5, colors.black, None, (4, 2)), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        story += [pt, Spacer(1, 4)]

    # Caixas dos níveis
    if not n1:
        n2_txt = "Depende do N1"
    elif not avaliadas:
        n2_txt = "Nenhuma função com meta com 3h ou mais"
    else:
        falhas = [x for x in avaliadas if not x[6]]
        n2_txt = (f"{len(avaliadas)} de {len(avaliadas)} {plural(len(avaliadas), 'função', 'funções')} na meta" if not falhas else
                  "Abaixo da meta: " + "; ".join(f"{f} ({br(p)} de {m} {UN[u]})" for f, s, q, p, m, u, ok in falhas))
    n3_txt = f"{len(ALERTAS)} {plural(len(ALERTAS), 'alerta')} no mês (limite: menos de 3)"
    if s3 == "BLOQUEADO": n3_txt += ". Depende do N1 e do N2"
    caixas = [("N1  Assiduidade", s1, f"{hm(total_seg)} de 100h00 exigidas"),
              ("N2  Produtividade", s2, n2_txt),
              ("N3  Excelência", s3, n3_txt)]
    linha, st = [], [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]
    for i, (tit, s, det) in enumerate(caixas):
        cor_txt = colors.white if s == "CONQUISTADO" else (CZ_ESC if s == "BLOQUEADO" else colors.black)
        simb = {"CONQUISTADO": "✔", "NÃO CONQUISTADO": "✘", "BLOQUEADO": "–"}[s]
        sty = lambda n, fs, ld: ParagraphStyle(n + str(i), fontName=n, fontSize=fs, leading=ld, alignment=1, textColor=cor_txt)
        linha.append([Paragraph(tit, sty("DVB", 9, 11)), Paragraph(f"{simb} {s}", sty("DVB", 12.5, 16)), Paragraph(det, sty("DV", 8, 10))])
        if s == "CONQUISTADO":
            st.append(("BACKGROUND", (2 * i, 0), (2 * i, 0), colors.black))
        elif s == "BLOQUEADO":
            st.append(("BOX", (2 * i, 0), (2 * i, 0), 1, CZ_ESC, None, (3, 2)))
        else:
            st.append(("BOX", (2 * i, 0), (2 * i, 0), 2.2, colors.black))
    tn = Table([[linha[0], "", linha[1], "", linha[2]]], colWidths=[6 * cm, 0.3 * cm, 6 * cm, 0.3 * cm, 6 * cm])
    tn.setStyle(TableStyle(st))
    story += [Spacer(1, 4), tn,
              Paragraph("Cada nível só pode ser conquistado se o nível anterior também for.", ParagraphStyle("o", parent=P, textColor=CZ_ESC, spaceBefore=3))]

    # Resultado por função
    fun = [["Função", "Horas", "Produzido", "Produtividade", "Meta", "Resultado contra a meta", ""]]
    st_f = []
    for f in vis:
        s, nt, vol, orig = mes[f]
        if f in METAS:
            meta, un, tipo = METAS[f]; q = qtd(f, nt, vol); prod = q / (s / 3600) if s else 0
            if s >= N2_MIN_SEG_FUNCAO:
                pct = prod / meta
                res = [barra(pct), Paragraph(f"<b>{'✔' if pct >= 1 else '✘'} {br(pct * 100, 0)}%</b>", P)]
            else:
                res = [Paragraph("menos de 3h: não conta para o N2", P), ""]
                st_f.append(("SPAN", (5, len(fun)), (6, len(fun))))
            fun.append([f, hm(s), f"{br(q, 0)} {'volumes' if tipo == 'vol' else 'pallets'}", f"{br(prod)} {UN[un]}", f"{br(meta, 0)} {UN[un]}", *res])
        else:
            fun.append([f, hm(s), f"{br(nt, 0)} {plural(nt, 'tarefa')}", "-", "sem meta", Paragraph("não conta para o N2", P), ""])
            st_f.append(("SPAN", (5, len(fun) - 1), (6, len(fun) - 1)))
    if outras:
        so, no_ = sum(mes[f][0] for f in outras), sum(mes[f][1] for f in outras)
        fun.append([Paragraph(f"Outras <font size=6.3>({', '.join(outras)})</font>", ParagraphStyle("pot", parent=P, leading=8)), hm(so), f"{br(no_, 0)} {plural(no_, 'tarefa')}", "-", "sem meta", Paragraph("não conta para o N2", P), ""])
        st_f.append(("SPAN", (5, len(fun) - 1), (6, len(fun) - 1)))
    fun.append(["Total de horas válidas", hm(total_seg), "", "", "", "", ""])
    tf = tabela(fun, [4.4 * cm, 1.6 * cm, 2.6 * cm, 2.8 * cm, 2.4 * cm, 2.7 * cm, 2.1 * cm])
    tf.setStyle(TableStyle(st_f + [("SPAN", (5, 0), (6, 0)), ("ALIGN", (5, 0), (-1, -1), "LEFT"),
                                   ("FONT", (0, -1), (-1, -1), "DVB", 8), ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black)]))
    story += [Spacer(1, 10), tf]

    # Comparação com o mês anterior
    if not ANT or ANT["total_seg"] == 0:
        story += [secao("Comparação com o mês anterior"), Spacer(1, 3), Paragraph("Sem dados do mês anterior para comparação.", N)]
    else:
        mes_a, aval_a = ANT["mes"], {x[0]: x for x in ANT["avaliadas"]}
        aval_c = {x[0]: x for x in avaliadas}
        vis_a = [f for f in sorted(mes_a, key=lambda f: -mes_a[f][0]) if mes_a[f][0] >= N2_MIN_SEG_FUNCAO]
        lin_f = vis + [f for f in vis_a if f not in vis]
        out_c = [f for f in mes if f not in lin_f]; out_a = [f for f in mes_a if f not in lin_f]
        def var_h(a, b):
            if hm(a) == hm(b): return "="
            d = b - a
            return f"{'↑ +' if d > 0 else '↓ -'}{hm(abs(d))}"
        def prod_txt(f, aval):
            if f not in aval: return "-"
            return f"{br(aval[f][3])} {UN[aval[f][5]]}"
        def var_p(f):
            if f not in aval_c or f not in aval_a: return "-"
            a, b = aval_a[f][3], aval_c[f][3]
            if br(a) == br(b): return "="
            if a == 0: return "↑"
            return f"{'↑ +' if b > a else '↓ '}{br((b / a - 1) * 100, 0)}%"
        ant_txt = cfg["anterior"]["mes_txt"].split("/")[0][:3]
        cur_txt = MES_TXT.split("/")[0][:3]
        PHC = ParagraphStyle("phc", fontName="DVB", fontSize=7.5, leading=9, alignment=2, textColor=colors.white)
        PHL = ParagraphStyle("phl", parent=PHC, alignment=0)
        cp = [["Função", Paragraph(f"Horas<br/>{ant_txt}", PHC), Paragraph(f"Horas<br/>{cur_txt}", PHC), Paragraph("Variação<br/>das horas", PHL),
               Paragraph(f"Produtiv.<br/>{ant_txt}", PHC), Paragraph(f"Produtiv.<br/>{cur_txt}", PHC), Paragraph("Variação da<br/>produtividade", PHL)]]
        cp.append(["Total de horas válidas", hm(ANT["total_seg"]), hm(total_seg), var_h(ANT["total_seg"], total_seg), "", "", ""])
        for f in lin_f:
            a, b = mes_a[f][0] if f in mes_a else 0, mes[f][0] if f in mes else 0
            cp.append([f, hm(a) if a else "-", hm(b) if b else "-", var_h(a, b), prod_txt(f, aval_a), prod_txt(f, aval_c), var_p(f)])
        if out_c or out_a:
            a, b = sum(mes_a[f][0] for f in out_a), sum(mes[f][0] for f in out_c)
            cp.append(["Outras", hm(a) if a else "-", hm(b) if b else "-", var_h(a, b), "-", "-", "-"])
        na, nc = len(ANT["ALERTAS"]), len(ALERTAS)
        cp.append(["Alertas", str(na), str(nc), "=" if na == nc else f"{'↑ +' if nc > na else '↓ -'}{abs(nc - na)}", "", "", ""])
        tc = tabela(cp, [3.9 * cm, 1.5 * cm, 1.5 * cm, 3.4 * cm, 2.1 * cm, 2.1 * cm, 4.1 * cm])
        tc.setStyle(TableStyle([("ALIGN", (3, 1), (3, -1), "LEFT"), ("ALIGN", (6, 1), (6, -1), "LEFT"),
                                ("LEFTPADDING", (3, 0), (3, -1), 12), ("LEFTPADDING", (6, 0), (6, -1), 18),
                                ("FONT", (0, 1), (-1, 1), "DVB", 8), ("FONT", (3, 1), (3, -1), "DVB", 8), ("FONT", (6, 1), (6, -1), "DVB", 8),
                                ("LINEBELOW", (0, 1), (-1, 1), 0.8, colors.black), ("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.black)]))
        simb = lambda s_: {"CONQUISTADO": "✔", "NÃO CONQUISTADO": "✘", "BLOQUEADO": "–"}[s_]
        niv_a = f"Níveis em {cfg['anterior']['mes_txt']}: N1 {simb(ANT['s1'])}  N2 {simb(ANT['s2'])}  N3 {simb(ANT['s3'])}"
        obs = ["↑ aumentou, ↓ diminuiu, = igual ao mês anterior. Produtividade só das funções com meta e 3h ou mais no mês."]
        if PARCIAL: obs.append("Mês atual parcial: as horas ainda não estão completas, compare principalmente a produtividade.")
        story += [secao(f"Comparação com o mês anterior ({cfg['anterior']['mes_txt']})"), Spacer(1, 4), tc,
                  Paragraph(f"<b>{niv_a}</b>. " + " ".join(obs), ParagraphStyle("o5", parent=P, textColor=CZ_ESC, spaceBefore=3))]

    # Como as horas foram contadas
    linhas_h = [["Horas válidas no mês", f"<b>{hm(total_seg)}</b>", f"App Tarefas {hm(seg_app)} + WMS {hm(seg_wms)}"],
                ["Tarefas do app não contadas por conflito com o WMS", f"<b>{len(conflitos)}</b>",
                 (f"{hm(seg_conf)} não {plural(len(conflitos), 'contada', 'contadas')}. Quando o app e o WMS registram o mesmo horário, vale o WMS."
                  if conflitos else "Nenhuma")],
                ["Tarefas encerradas automaticamente (timeout) e somadas", f"<b>{len(timeouts)}</b>", f"{hm(seg_to)} somadas" if timeouts else "Nenhuma"]]
    th = Table([[Paragraph(a, N), Paragraph(b, ParagraphStyle("r", parent=N, alignment=2)), Paragraph(c, P)] for a, b, c in linhas_h],
               colWidths=[7.4 * cm, 1.8 * cm, 9.4 * cm])
    th.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.3, CZ_MED), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [secao("Como as horas foram contadas"), Spacer(1, 2), th]

    # Alertas
    story += [secao(f"Alertas do mês ({len(ALERTAS)})"), Spacer(1, 4)]
    if ALERTAS:
        PA = ParagraphStyle("pa7", parent=P, fontSize=7, leading=8.4)
        story.append(tabela([["Data", "Descrição", "Emissor"]] + [[a, Paragraph(b, PA), c] for a, b, c in ALERTAS],
                            [2.6 * cm, 14.3 * cm, 1.7 * cm], fs=7.5, alinhar_dir_de=9))
    else:
        story.append(Paragraph("Nenhum alerta no mês.", N))

    # ---------------- FOLHA 2 ----------------
    story += [CondPageBreak(19 * cm), secao("Horas por dia e função"), Spacer(1, 4)]
    cols = vis + (["Outras"] if outras else [])
    nf = len(cols)
    larg_f = (LARG - 1.9 * cm - 1.5 * cm) / max(nf, 1)
    fs = 7 if nf <= 9 else 6.2
    PH = ParagraphStyle("ph", fontName="DVB", fontSize=fs - 1, leading=fs, alignment=1, textColor=colors.white, splitLongWords=0)
    grade = [[Paragraph("Dia", PH)] + [Paragraph(f, PH) for f in cols] + [Paragraph("Total do dia", PH)]]
    for d in dias:
        wd = SEM[dt.date.fromisoformat(d).weekday()]
        lin = [f"{dia_br(d)} {wd}" + (" *" if d in dias_conf else "")]
        for f in cols:
            sv = sum(agg[(d, g, mes[g][3])][0] for g in (outras if f == "Outras" else [f]) if (d, g, mes[g][3]) in agg)
            lin.append(hm(sv) if sv > 0 else "")
        lin.append(hm(sum(v[0] for k, v in agg.items() if k[0] == d)))
        grade.append(lin)
    grade.append(["Total"] + [hm(sum(mes[g][0] for g in (outras if f == "Outras" else [f]))) for f in cols] + [hm(total_seg)])
    tg = Table(grade, colWidths=[1.9 * cm] + [larg_f] * nf + [1.5 * cm], repeatRows=1)
    sg = [("FONT", (0, 1), (-1, -1), "DV", fs), ("BACKGROUND", (0, 0), (-1, 0), colors.black),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 1), (-1, -1), "CENTER"), ("LEFTPADDING", (0, 0), (-1, 0), 1), ("RIGHTPADDING", (0, 0), (-1, 0), 1),
          ("TOPPADDING", (0, 1), (-1, -1), 1.6), ("BOTTOMPADDING", (0, 1), (-1, -1), 1.6),
          ("LINEBELOW", (0, 1), (-1, -2), 0.3, CZ_MED), ("LINEBEFORE", (-1, 0), (-1, -1), 1, colors.black),
          ("FONT", (-1, 1), (-1, -1), "DVB", fs), ("FONT", (0, -1), (-1, -1), "DVB", fs),
          ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black)]
    for i in range(1, len(grade) - 1):
        if dt.date.fromisoformat(dias[i - 1]).weekday() == 0 and i > 1:
            sg.append(("LINEABOVE", (0, i), (-1, i), 0.9, colors.black))
    tg.setStyle(TableStyle(sg))
    story.append(tg)
    nota = ["Linha mais grossa: início de uma nova semana (segunda-feira). Dias sem trabalho registrado não aparecem."]
    if dias_conf:
        nota.append("* Dia com tarefa do app não contada por conflito com o WMS: " +
                    "; ".join(f"{dia_br(d)} ({n} {plural(n, 'tarefa')}, {hm(sum(c[5] for c in conflitos if c[3][:10] == d))})" for d, n in sorted(dias_conf.items())) +
                    ". As horas da grade já estão sem essas tarefas.")
    story.append(Paragraph(" ".join(nota), ParagraphStyle("o3", parent=P, textColor=CZ_ESC, spaceBefore=3)))

    # Gráfico: produtividade diária por função com meta, em % da meta
    g2 = os.path.join(pasta, f"_g_pct_{CRACHA}.png")
    aval_f = [x[0] for x in sorted(avaliadas, key=lambda x: -x[1])]
    tem_g2 = bool(aval_f)
    if tem_g2:
        ncol = 3 if len(aval_f) > 2 else len(aval_f); nlin = -(-len(aval_f) // ncol)
        alt = 1.55 * nlin + 0.2
        fig, axs = plt.subplots(nlin, ncol, figsize=(8, alt), dpi=200, squeeze=False)
        for j, f in enumerate(aval_f):
            ax = axs[j // ncol][j % ncol]; meta, un, tipo = METAS[f]; xs, ys = [], []
            for i, d in enumerate(dias):
                v = agg.get((d, f, mes[f][3]))
                if v and v[0] >= 1800:   # só dias com 30 min ou mais na função
                    xs.append(i); ys.append(qtd(f, v[1], v[2]) / (v[0] / 3600))
            ax.bar(xs, ys, color=["#AAAAAA" if y >= meta else "black" for y in ys], width=0.8)
            ax.axhline(meta, color="black", ls="--", lw=1)
            prod_m = [x[3] for x in avaliadas if x[0] == f][0]
            ax.set_title(f"{f}: {br(prod_m)} {UN[un]} no mês (meta {meta} {UN[un]})", fontsize=6.8, loc="left", fontweight="bold")
            ax.set_xlim(-0.7, len(dias) - 0.3); ax.set_xticks(range(len(dias)))
            ax.set_xticklabels([dia_br(d)[:2] if k % 2 == 0 else "" for k, d in enumerate(dias)], fontsize=5)
            ax.tick_params(labelsize=5.5, length=2); ax.spines[["top", "right"]].set_visible(False)
            ax.set_ylim(0, max(ys + [meta]) * 1.15)
        for j in range(len(aval_f), nlin * ncol): axs[j // ncol][j % ncol].axis("off")
        plt.tight_layout(h_pad=0.6, w_pad=0.8); plt.savefig(g2); plt.close()
        story += [KeepTogether([secao("Produtividade diária contra a meta (funções que contam para o N2)"), Spacer(1, 3),
                                Image(g2, width=LARG, height=LARG * alt / 8),
                                Paragraph("Cada barra é a produtividade do dia na função. A linha tracejada é a meta. Barras pretas: dias abaixo da meta; barras cinza: dias na meta ou acima. "
                                          "Só aparecem dias com 30 minutos ou mais na função.", ParagraphStyle("o4", parent=P, textColor=CZ_ESC))])]

    import copy, io
    doc_kw = dict(pagesize=A4, leftMargin=1.2 * cm, rightMargin=1.2 * cm, topMargin=1.0 * cm, bottomMargin=1.2 * cm, title=f"Performance {CRACHA} {MES_TXT}")
    SimpleDocTemplate(io.BytesIO(), **doc_kw).build(copy.deepcopy(story), onFirstPage=rodape, onLaterPages=rodape)   # 1ª passagem: conta as páginas
    TOT_PAG[1] = TOT_PAG[0]
    SimpleDocTemplate(OUT, **doc_kw).build(story, onFirstPage=rodape, onLaterPages=rodape)
    for g in (g2,):
        if os.path.exists(g): os.remove(g)

    # ---- Anomalias (só para o resumo da conversa, não vão ao PDF) ----
    an = []
    for a, b, sob in anom_app:
        an.append(f"App x App {dia_br(a[3])}: {b[1]} ({b[3][11:19]} às {b[4][11:19]}) dentro de {a[1]} ({a[3][11:19]} às {a[4][11:19]}); "
                  f"{hm(sob)} contados uma vez só (descontados da tarefa iniciada primeiro)")
    for a, b, sob in anom_wms:
        an.append(f"WMS x WMS {dia_br(a[2])}: {a[1]} {a[0]} ({a[2][11:19]} às {a[3][11:19]}) e {b[1]} {b[0]} ({b[2][11:19]} às {b[3][11:19]}): {int(sob)} s sobrepostos")
    for rid, tar, st_, ini, fim, seg, vol, cf in app:
        if cf: continue
        if tar == "Carregamento" and vol is None:
            an.append(f"Carga sem volume {dia_br(ini)}: Carregamento {ini[11:16]} às {fim[11:16]} ({hm(seg - ajuste.get(rid, 0))}), horas somadas, volume zero")
        if len(rid) >= 15 and rid[1:9] == ini[:10].replace("-", "") and rid[9:15] != ini[11:19].replace(":", ""):
            an.append(f"Horário divergente {dia_br(ini)}: {tar} {rid} indica início {rid[9:11]}:{rid[11:13]}:{rid[13:15]}, gravado {ini[11:19]} (fim {fim[11:19]}); somado como gravado")
    cf_lista = []
    for rid, tar, st_, ini, fim, seg, num in conflitos:
        wt, wi, wf = wms_por_num[num]
        sob = max(0, (min(T(fim), T(wf)) - max(T(ini), T(wi))).total_seconds())
        cf_lista.append(f"{dia_br(ini)} {ini[11:16]} às {fim[11:16]} {tar}{' (timeout)' if st_ == 'timeout' else ''} ({hm(seg)}) x WMS {num} {wt} "
                        f"{wi[11:16]} às {wf[11:16]}: {int(sob // 60)} min {int(sob % 60)} s sobrepostos")


    # ---- Resumo para o chat ----
    r = {"arquivo": OUT, "total": hm(total_seg), "app": hm(seg_app), "wms": hm(seg_wms),
         "conflito": f"{hm(seg_conf)} ({len(conflitos)})", "timeouts_somados": len(timeouts), "dias": len(dias),
         "N1": s1, "N2": s2, "N3": s3, "alertas": len(ALERTAS),
         "funcoes": [(f, mes[f][3], hm(mes[f][0]), mes[f][1], mes[f][2]) for f in ordem_func],
         "n2_avaliadas": [(f, hm(s), q, br(p), m, "sim" if ok else "não") for f, s, q, p, m, u, ok in avaliadas],
         "conflitos_lista": cf_lista, "timeouts_lista": [f"{dia_br(i)} {i[11:16]} às {f_[11:16]} {t} ({hm(sg)} registradas, {hm(s_)} somadas)" for _, t, i, f_, sg, s_ in timeouts],
         "anomalias": an, "wms_sem_vinculo": int(cfg.get("wms_sem_vinculo", 0)),
         "mes_anterior": ({"mes": cfg["anterior"]["mes_txt"], "total": hm(ANT["total_seg"]), "N1": ANT["s1"], "N2": ANT["s2"], "N3": ANT["s3"],
                           "alertas": len(ANT["ALERTAS"])} if ANT else None)}
    print(json.dumps(r, ensure_ascii=False, indent=1))
    return r


if __name__ == "__main__":
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    gerar(cfg, sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(sys.argv[1])))
