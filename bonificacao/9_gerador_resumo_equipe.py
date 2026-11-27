#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GERADOR PADRÃO DO FECHAMENTO DA EQUIPE (Bonificação Logística)
Versão 1.1 (27/11/2026): a conferência mostra as horas das trocas de bateria (regra 2 v1.6) junto com App e WMS.
Versão 1.0 (26/11/2026), aprovada pela gerência.

NÃO ALTERAR cálculos, cores, colunas ou textos sem pedido da gerência. Qualquer mudança aprovada
deve ser feita aqui e em 2_regras_de_calculo.md (regra 13) e claude/9_fechamento_equipe.md.

Não recalcula nada: usa somente o resumo em JSON que o gerador individual
(7_gerador_relatorio_performance.py) imprime para cada funcionário.

Gera três arquivos na pasta de saída:
  resumo_rh_<AAAA-MM>.pdf          resumo colorido para o RH (vai por e-mail); só com o mês completo
  impressao_equipe_<AAAA-MM>.pdf   todos os PDFs individuais num arquivo só, por nome,
                                   cada funcionário começando numa folha nova (frente e verso)
  conferencia_equipe_<AAAA-MM>.pdf uso interno da gerência: conflitos, timeouts, anomalias, WMS sem vínculo

Uso:
    python3 9_gerador_resumo_equipe.py entrada_equipe.json pasta_saida

Formato do entrada_equipe.json:
{
  "mes_txt": "Novembro/2026", "aaaamm": "2026-11", "gerado": "01/12/2026",
  "mes_anterior_txt": "Outubro/2026",
  "wms_sem_vinculo": 0,                  # tarefas do WMS sem funcionário no período
  "funcionarios": [
     {"cracha": "PL16", "nome": "Nome Completo", "resumo": {... saída JSON do gerador 7 ...},
      "extras": []}                        # opcional: textos para a conferência (regra 9, mês anterior incompleto)
  ],
  "avisos": [],                          # opcional: textos gerais para a conferência (ex.: cobertura)
  "fora_do_rh": [{"cracha": "PL5", "motivo": "pedido da gerência em 01/12/2026"}]
}
Quem está em "fora_do_rh" some, sem nenhuma menção, do resumo do RH, do PDF de impressão e da conferência.
O motivo fica só no entrada_equipe.json (registro interno).
"""
import json, os, sys, unicodedata
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ======================= PARÂMETROS (Programa de Bonificação) =======================
VALOR_NIVEL = {"N1": 50.00, "N2": 100.00, "N3": 150.00}   # valores acumulam: N3 = 50 + 100 + 150
UNIDADE = {"Carregamento": "V/h", "Separação Manual": "V/h", "Separação Empilhadeira": "P/h",
           "Realocação de estoque": "P/h", "Armazenagem": "P/h", "Recebimento": "P/h"}
# =====================================================================================

VERDE, VERMELHO, CINZA = colors.HexColor("#1E7B45"), colors.HexColor("#B3261E"), colors.HexColor("#8A8A8A")
COR_NIVEL = {"N3": colors.HexColor("#1E7B45"), "N2": colors.HexColor("#2F6DB5"),
             "N1": colors.HexColor("#C98A12"), "SEM": colors.HexColor("#7A7A7A")}
FUNDO_NIVEL = {"N3": colors.HexColor("#E4F2E9"), "N2": colors.HexColor("#E3EDF8"),
               "N1": colors.HexColor("#FBF1DC"), "SEM": colors.HexColor("#EFEFEF")}
ROTULO = {"N3": "N3 Excelência", "N2": "N2 Produtividade", "N1": "N1 Assiduidade", "SEM": "Sem bonificação"}


def _fonte():
    base = "/usr/share/fonts/truetype/dejavu/"
    pdfmetrics.registerFont(TTFont("DV", base + "DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DVB", base + "DejaVuSans-Bold.ttf"))


def br(x, casas=1):
    return f"{x:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def rs(v):
    return "R$ " + br(v, 2)


def chave_nome(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def nivel_final(n1, n2, n3):
    if n3 == "CONQUISTADO": return "N3"
    if n2 == "CONQUISTADO": return "N2"
    if n1 == "CONQUISTADO": return "N1"
    return "SEM"


def valor(nivel):
    tot = 0.0
    for n in ("N1", "N2", "N3"):
        if nivel == "SEM": break
        tot += VALOR_NIVEL[n]
        if n == nivel: break
    return tot


def motivo(r):
    """Por que parou: só o primeiro nível não conquistado (os seguintes ficam bloqueados)."""
    if r["N1"] != "CONQUISTADO":
        return f"N1: {r['total']} de 100h00 exigidas"
    if r["N2"] != "CONQUISTADO":
        abaixo = [a for a in r["n2_avaliadas"] if a[5] != "sim"]
        return "N2: abaixo da meta em " + "; ".join(f"{f} ({p} de {m} {UNIDADE.get(f, '')})" for f, h, q, p, m, ok in abaixo)
    if r["N3"] != "CONQUISTADO":
        return f"N3: {r['alertas']} alertas no mês (limite: menos de 3)"
    return ""


def gerar_rh(cfg, pasta):
    fora = {x["cracha"] for x in cfg.get("fora_do_rh", [])}
    pessoas = []
    for f in cfg["funcionarios"]:
        if f["cracha"] in fora: continue
        r = f["resumo"]
        nv = nivel_final(r["N1"], r["N2"], r["N3"])
        ant = r.get("mes_anterior")
        nv_a = nivel_final(ant["N1"], ant["N2"], ant["N3"]) if ant and ant.get("total") not in (None, "0h00") else None
        pessoas.append(dict(cracha=f["cracha"], nome=f["nome"], r=r, nivel=nv, valor=valor(nv),
                            motivo=motivo(r), nivel_a=nv_a, valor_a=valor(nv_a) if nv_a else None))
    pessoas.sort(key=lambda p: chave_nome(p["nome"]))

    H1 = ParagraphStyle("h1", fontName="DVB", fontSize=15, leading=19)
    SUB = ParagraphStyle("sub", fontName="DV", fontSize=9, leading=12, textColor=colors.HexColor("#444444"))
    SEC = ParagraphStyle("sec", fontName="DVB", fontSize=11, leading=14)
    P = ParagraphStyle("p", fontName="DV", fontSize=8, leading=10)
    PB = ParagraphStyle("pb", fontName="DVB", fontSize=8, leading=10)
    PN = ParagraphStyle("pn", fontName="DV", fontSize=7.2, leading=9, textColor=colors.HexColor("#555555"))
    LARG = 18.6 * cm

    def secao(txt):
        t = Table([[Paragraph(txt, SEC)]], colWidths=[LARG])
        t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor("#333333")), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 12)]))
        return t

    if "parcial" in cfg["mes_txt"].lower() or cfg.get("parcial"):
        raise SystemExit("PARADO: o resumo do RH só é gerado com o mês completo (regra 13).")
    mes_g, _, mes_r = cfg["mes_txt"].partition(" (")
    cab = Table([[Paragraph("Programa de Bonificação por Níveis", H1), Paragraph(f"<b>{mes_g}</b>", ParagraphStyle("m", parent=H1, alignment=2))],
                 [Paragraph("Resumo do resultado da equipe de Logística", SUB),
                  Paragraph((f"<b>({mes_r}</b> | " if mes_r else "") + f"Gerado em {cfg['gerado']}", ParagraphStyle("g", parent=SUB, alignment=2))]],
                colWidths=[11 * cm, 7.6 * cm])
    cab.setStyle(TableStyle([("LINEBELOW", (0, -1), (-1, -1), 2, COR_NIVEL["N3"]), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, -1), (-1, -1), 6)]))
    story = [cab, Spacer(1, 8)]

    # ---- Cartões por nível ----
    ordem = ["N3", "N2", "N1", "SEM"]
    cont = {n: [p for p in pessoas if p["nivel"] == n] for n in ordem}
    cards = []
    for n in ordem:
        q = len(cont[n])
        vu = valor(n)
        linha_v = (f"{rs(vu)} cada<br/>total <b>{rs(vu * q)}</b>" if n != "SEM" else "R$ 0,00<br/>&nbsp;")
        cor = COR_NIVEL[n]
        cards.append([Paragraph(ROTULO[n], ParagraphStyle("c1" + n, fontName="DVB", fontSize=8.5, leading=10, textColor=cor, alignment=1)),
                      Paragraph(str(q), ParagraphStyle("c2" + n, fontName="DVB", fontSize=24, leading=27, textColor=cor, alignment=1)),
                      Paragraph(plural_func(q), ParagraphStyle("c3" + n, fontName="DV", fontSize=7.5, leading=9, alignment=1)),
                      Paragraph(linha_v, ParagraphStyle("c4" + n, fontName="DV", fontSize=7.3, leading=9, alignment=1))])
    tc = Table([[cards[0], "", cards[1], "", cards[2], "", cards[3]]],
               colWidths=[4.35 * cm, 0.3 * cm, 4.35 * cm, 0.3 * cm, 4.35 * cm, 0.3 * cm, 4.35 * cm])
    stc = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]
    for i, n in enumerate(ordem):
        stc += [("BACKGROUND", (2 * i, 0), (2 * i, 0), FUNDO_NIVEL[n]), ("LINEABOVE", (2 * i, 0), (2 * i, 0), 3, COR_NIVEL[n])]
    tc.setStyle(TableStyle(stc))
    total_pg = sum(p["valor"] for p in pessoas)
    tot = Table([[Paragraph(f"<b>{len(pessoas)}</b> funcionários avaliados", P),
                  Paragraph(f"Total da bonificação: <b>{rs(total_pg)}</b>", ParagraphStyle("t2", parent=P, alignment=2))]],
                colWidths=[6 * cm, 12.6 * cm])
    tot.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [tc, Spacer(1, 4), tot]

    # ---- Quem ficou em cada nível ----
    story += [secao("Funcionários por nível")]
    lin = []
    for n in ordem:
        nomes = ", ".join(p["nome"] for p in cont[n]) or "Ninguém"
        lin.append([Paragraph(f"<font color='{COR_NIVEL[n].hexval().replace('0x', '#')}'><b>{ROTULO[n]}</b></font>", P), Paragraph(nomes, P)])
    tl = Table(lin, colWidths=[3.6 * cm, 15 * cm])
    tl.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#CCCCCC")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [Spacer(1, 2), tl]

    # ---- Tabela por funcionário ----
    story += [secao("Resultado por funcionário (ordem alfabética)"), Spacer(1, 4)]
    HC = ParagraphStyle("hc", fontName="DVB", fontSize=7.3, leading=8.5, alignment=1, textColor=colors.white)
    HL = ParagraphStyle("hl", parent=HC, alignment=0)
    dados = [[Paragraph("Nome", HL), Paragraph("N1", HC), Paragraph("N2", HC), Paragraph("N3", HC), Paragraph("Bonificação", HC),
              Paragraph("Motivo (nível não conquistado)", HL), Paragraph(f"Nível em<br/>{cfg.get('mes_anterior_txt', 'mês anterior')}", HC)]]
    st = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2B2B2B")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor("#CCCCCC")), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
          ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]
    SIMB = {"CONQUISTADO": ("✔", VERDE), "NÃO CONQUISTADO": ("✘", VERMELHO), "BLOQUEADO": ("–", CINZA)}
    PC = ParagraphStyle("pc", parent=P, alignment=1)
    PCB = ParagraphStyle("pcb", fontName="DVB", fontSize=10, leading=11, alignment=1)
    for i, p in enumerate(pessoas, start=1):
        r = p["r"]
        cel = []
        for n in ("N1", "N2", "N3"):
            s, c = SIMB[r[n]]
            cel.append(Paragraph(f"<font color='{c.hexval().replace('0x', '#')}'>{s}</font>", PCB))
        ant_txt = "sem dados" if p["nivel_a"] is None else ("Sem bonificação" if p["nivel_a"] == "SEM" else p["nivel_a"])
        dados.append([Paragraph(f"<b>{p['nome']}</b>", P), *cel,
                      Paragraph(f"<b>{rs(p['valor'])}</b>", ParagraphStyle("v", parent=P, alignment=2)),
                      Paragraph(p["motivo"] or "<font color='#1E7B45'>Todos os níveis conquistados</font>", P),
                      Paragraph(ant_txt, PC)])
        st.append(("LINEBEFORE", (0, i), (0, i), 3, COR_NIVEL[p["nivel"]]))
    dados.append([Paragraph("<b>Total</b>", P), "", "", "", Paragraph(f"<b>{rs(total_pg)}</b>", ParagraphStyle("vt", parent=P, alignment=2)), "", ""])
    st += [("LINEABOVE", (0, -1), (-1, -1), 1, colors.black), ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F3F3F3"))]
    t = Table(dados, colWidths=[4.6 * cm, 0.8 * cm, 0.8 * cm, 0.8 * cm, 2.0 * cm, 6.6 * cm, 3.0 * cm], repeatRows=1)
    t.setStyle(TableStyle(st))
    story.append(t)

    notas = [f"Valores: N1 {rs(VALOR_NIVEL['N1'])}; N2 mais {rs(VALOR_NIVEL['N2'])} (total {rs(valor('N2'))}); "
             f"N3 mais {rs(VALOR_NIVEL['N3'])} (total {rs(valor('N3'))}). Cada nível só pode ser conquistado se o anterior também for.",
             "✔ conquistado, ✘ não conquistado, – bloqueado (o nível anterior não foi conquistado).",
             f"Nível em {cfg.get('mes_anterior_txt', 'mês anterior')}: nível do mesmo funcionário no mês anterior, calculado com as regras atuais. "
             "\"sem dados\": sem horas no mês anterior."]
    story += [Spacer(1, 6)] + [Paragraph(n, PN) for n in notas]

    def rodape(c, doc):
        c.saveState(); c.setFont("DV", 7); c.setFillColor(colors.HexColor("#555555"))
        c.drawString(1.2 * cm, 0.7 * cm, f"Programa de Bonificação por Níveis | Resumo da equipe | {cfg['mes_txt']}")
        c.drawRightString(A4[0] - 1.2 * cm, 0.7 * cm, f"Página {doc.page}"); c.restoreState()

    out = os.path.join(pasta, f"resumo_rh_{cfg['aaaamm']}.pdf")
    SimpleDocTemplate(out, pagesize=A4, leftMargin=1.2 * cm, rightMargin=1.2 * cm, topMargin=1.1 * cm, bottomMargin=1.3 * cm,
                      title=f"Bonificação {cfg['mes_txt']}").build(story, onFirstPage=rodape, onLaterPages=rodape)
    return out, pessoas


def plural_func(q):
    return "funcionário" if q == 1 else "funcionários"


def ativos(cfg):
    fora = {x["cracha"] for x in cfg.get("fora_do_rh", [])}
    return sorted([f for f in cfg["funcionarios"] if f["cracha"] not in fora], key=lambda f: chave_nome(f["nome"]))


def juntar_impressao(cfg, pasta):
    """Um PDF só, por nome; página em branco quando o relatório tem nº ímpar de páginas,
    para cada funcionário começar na frente de uma folha nova."""
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for f in ativos(cfg):
        rd = PdfReader(f["resumo"]["arquivo"])
        for pg in rd.pages: w.add_page(pg)
        if len(rd.pages) % 2: w.add_blank_page(width=A4[0], height=A4[1])
    out = os.path.join(pasta, f"impressao_equipe_{cfg['aaaamm']}.pdf")
    with open(out, "wb") as fh: w.write(fh)
    return out


def gerar_conferencia(cfg, pasta):
    """Uso interno da gerência: o que o passo 6 do arquivo 6 traria na conversa, para todos."""
    H1 = ParagraphStyle("ch1", fontName="DVB", fontSize=13, leading=16)
    H2 = ParagraphStyle("ch2", fontName="DVB", fontSize=9.5, leading=12, spaceBefore=9, spaceAfter=2)
    P = ParagraphStyle("cp", fontName="DV", fontSize=7.5, leading=9.5)
    PB = ParagraphStyle("cpb", fontName="DVB", fontSize=7.5, leading=9.5, spaceBefore=3)
    esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    story = [Paragraph(f"Conferência interna do fechamento | {cfg['mes_txt']}", H1),
             Paragraph(f"Gerado em {cfg['gerado']}. Uso da gerência, não enviar ao RH nem aos funcionários.", P),
             Paragraph(f"Tarefas do WMS sem vínculo no período: <b>{cfg.get('wms_sem_vinculo', 0)}</b>.", P)]
    for f in cfg.get("avisos", []):
        story.append(Paragraph("Aviso: " + esc(f), P))
    for f in ativos(cfg):
        r = f["resumo"]
        story.append(Paragraph(f"{esc(f['nome'])} ({f['cracha']}) | {r['total']} (App {r.get('app', '-')} + WMS {r.get('wms', '-')}" + (f" + Trocas de bateria {r['baterias']} ({r.get('baterias_qtd', 0)})" if r.get('baterias_qtd') else "") + f") | "
                               f"N1 {r['N1']}, N2 {r['N2']}, N3 {r['N3']} | {r['alertas']} alertas", H2))
        for tit, chave in (("Conflitos (não contados)", "conflitos_lista"), ("Timeouts (somados)", "timeouts_lista"), ("Anomalias", "anomalias")):
            itens = r.get(chave) or []
            story.append(Paragraph(f"{tit}: {len(itens) if itens else 'nenhum'}", PB))
            for it in itens: story.append(Paragraph("• " + esc(it), P))
        for it in f.get("extras", []):   # ex.: regra 9 (volumes repetidos no Carregamento), mês anterior incompleto
            story.append(Paragraph("• " + esc(it), P))
    out = os.path.join(pasta, f"conferencia_equipe_{cfg['aaaamm']}.pdf")
    SimpleDocTemplate(out, pagesize=A4, leftMargin=1.2 * cm, rightMargin=1.2 * cm, topMargin=1.1 * cm, bottomMargin=1.2 * cm,
                      title=f"Conferência {cfg['mes_txt']}").build(story)
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3: raise SystemExit(__doc__)
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    _fonte()
    pasta = sys.argv[2]; os.makedirs(pasta, exist_ok=True)
    rh, pessoas = gerar_rh(cfg, pasta)
    saida = {"resumo_rh": rh, "funcionarios_no_rh": len(pessoas),
             "por_nivel": {n: [p["nome"] for p in pessoas if p["nivel"] == n] for n in ("N3", "N2", "N1", "SEM")},
             "total": rs(sum(p["valor"] for p in pessoas)),
             "tabela": [(p["nome"], p["cracha"], p["r"]["total"], p["r"]["N1"], p["r"]["N2"], p["r"]["N3"], rs(p["valor"]), p["motivo"],
                         p["nivel_a"] or "sem dados") for p in pessoas],
             "conferencia": gerar_conferencia(cfg, pasta)}
    faltam = [f["cracha"] for f in ativos(cfg) if not os.path.exists(f["resumo"].get("arquivo", ""))]
    saida["impressao"] = juntar_impressao(cfg, pasta) if not faltam else f"NÃO GERADO: faltam os PDFs de {faltam}"
    print(json.dumps(saida, ensure_ascii=False, indent=1))
