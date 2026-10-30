"""Layout of an Austrian Schriftsatz (Klage, Klagebeantwortung, Rechtsmittel …) with python-docx.

The drafting model writes the text line by line with markers; this module sets the layout, so
the Rubrum and the formatting are the same in every brief:

    [ADRESSAT] An das            [AZ] 12 Cg 34/26x
    [ADRESSAT] Landesgericht für ZRS Wien
    [PARTEI] Klagende Partei: | Name; Anschrift; FN
    [PARTEI] vertreten durch: | Kanzlei; Anschrift; Code (Vollmacht erteilt gemäß § 30 Abs 2 ZPO)
    [PARTEI] Beklagte Partei: | …
    [WEGEN] EUR 18.400,-- s.A.   [STREITWERT] EUR 18.400,--
    [RUBRUM] Berufungsinteresse: | EUR 18.400,--      (any further Rubrum line)
    [TITEL] KLAGE                [UNTERTITEL] …            [BEILAGEN] ./A bis ./F
    [H] I. Sachverhalt           [P] 1. …                  [BEWEIS] ./A Rechnung; PV; Zeuge …
    [ANTRAG] Die beklagte Partei ist schuldig, …
    [SCHLUSS] Wien, am [Datum] | Klagende Partei

Lines without a marker continue the previous paragraph type. Placeholders in [ … ] are
highlighted yellow.

    import sys; sys.path.insert(0, '/home/user/.aiss')
    from brief_layout import render
    render(TEXT, '/home/user/Klage.docx')
"""
import re

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

MARKERS = ('ADRESSAT', 'AZ', 'PARTEI', 'WEGEN', 'STREITWERT', 'RUBRUM', 'TITEL', 'UNTERTITEL', 'BEILAGEN', 'H', 'P', 'BEWEIS', 'ANTRAG', 'SCHLUSS')
LINE = re.compile(r'^\s*\[(%s)\]\s?(.*)$' % '|'.join(MARKERS))
PLACEHOLDER = re.compile(r'(\[[^\[\]]*\])')
FONT = 'Arial'
LABEL_W, VALUE_W = Cm(4.5), Cm(12.0)  # A4 minus margins (2.5 + 2 cm) = 16.5 cm


def parse(text):
    """[(marker, text)] – unmarked lines join the paragraph before them."""
    items = []
    for raw in str(text).replace('\r\n', '\n').split('\n'):
        m = LINE.match(raw)
        if m:
            items.append([m.group(1), m.group(2).strip()])
        elif raw.strip():
            if items and items[-1][0] in ('P', 'ANTRAG', 'H', 'BEWEIS'):
                items[-1][1] += ' ' + raw.strip()
            else:
                items.append(['P', raw.strip()])
    return items


def runs(par, text, bold=False, italic=False, size=None):
    for part in PLACEHOLDER.split(text):
        if not part:
            continue
        r = par.add_run(part)
        if bold:
            r.bold = True
        if italic:
            r.italic = True
        if size:
            r.font.size = Pt(size)
        if PLACEHOLDER.fullmatch(part) and not re.fullmatch(r'\[\d+\]', part):
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    return par


def fmt(par, before=0, after=6, align=None, left=None, right=None, first=None, spacing=1.15, keep_next=False):
    f = par.paragraph_format
    f.space_before, f.space_after, f.line_spacing = Pt(before), Pt(after), spacing
    if align is not None:
        par.alignment = align
    if left is not None:
        f.left_indent = Cm(left)
    if right is not None:
        f.right_indent = Cm(right)
    if first is not None:
        f.first_line_indent = Cm(first)
    if keep_next:
        f.keep_with_next = True
    return par


def tab_stop(par, cm):
    par.paragraph_format.tab_stops.add_tab_stop(Cm(cm))


def field(par, instr, size=9):
    def fld(kind):
        r = par.add_run()
        e = OxmlElement('w:fldChar')
        e.set(qn('w:fldCharType'), kind)
        r._r.append(e)
        r.font.size = Pt(size)
    fld('begin')
    r = par.add_run()
    t = OxmlElement('w:instrText')
    t.set(qn('xml:space'), 'preserve')
    t.text = instr
    r._r.append(t)
    fld('separate')
    par.add_run('1').font.size = Pt(size)
    fld('end')


def widths(table, *cols):
    """Column widths in the table grid as well as in every cell (Word and LibreOffice read different ones)."""
    for col, w in zip(table.columns, cols):
        col.width = w
    for row in table.rows:
        for cell, w in zip(row.cells, cols):
            cell.width = w


def borderless(table):
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        b = OxmlElement('w:' + side)
        b.set(qn('w:val'), 'nil')
        borders.append(b)
    tbl_pr.append(borders)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False


def cell_text(cell, lines, bold_first=False, align=None, size=None):
    cell.paragraphs[0].text = ''
    for i, line in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        fmt(p, after=0, align=align, spacing=1.15)
        runs(p, line, bold=bold_first and i == 0, size=size)


def setup(doc):
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)
    sec.top_margin, sec.bottom_margin, sec.left_margin, sec.right_margin = Cm(2.5), Cm(2.0), Cm(2.5), Cm(2.0)
    normal = doc.styles['Normal']
    normal.font.name, normal.font.size = FONT, Pt(11)
    rpr = normal.element.get_or_add_rPr()
    fonts = rpr.find(qn('w:rFonts'))
    if fonts is None:
        fonts = OxmlElement('w:rFonts')
        rpr.append(fonts)
    for k in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        fonts.set(qn(k), FONT)
    foot = sec.footer.paragraphs[0]
    fmt(foot, after=0, align=WD_ALIGN_PARAGRAPH.RIGHT)
    foot.add_run('Seite ').font.size = Pt(9)
    field(foot, 'PAGE')
    foot.add_run(' von ').font.size = Pt(9)
    field(foot, 'NUMPAGES')


def head(doc, adressat, az):
    """Addressee top left (court in bold), file number top right."""
    t = doc.add_table(rows=1, cols=2)
    borderless(t)
    widths(t, Cm(10.5), Cm(6.0))
    left, right = t.rows[0].cells
    left.paragraphs[0].text = ''
    lines = adressat or ['An das', '[Gericht]', '[Anschrift]']
    court = 1 if lines[0].lower().startswith('an ') and len(lines) > 1 else 0
    for i, line in enumerate(lines):
        p = left.paragraphs[0] if i == 0 else left.add_paragraph()
        fmt(p, after=0)
        runs(p, line, bold=i == court)
    cell_text(right, az, align=WD_ALIGN_PARAGRAPH.RIGHT)
    fmt(doc.add_paragraph(), after=10)


def parties(doc, rows):
    """Rubrum table: label | details (lines split at ';')."""
    t = doc.add_table(rows=0, cols=2)
    borderless(t)
    for i, (kind, label, value) in enumerate(rows):
        r = t.add_row().cells
        lines = [x.strip() for x in value.split(';') if x.strip()] or ['']
        cell_text(r[0], [label])
        cell_text(r[1], lines, bold_first=(kind == 'PARTEI' and not label.lower().startswith('vertreten')))
        new_block = i > 0 and (kind != 'PARTEI' or not label.lower().startswith('vertreten'))
        if new_block:
            gap = 12 if kind == 'WEGEN' or (kind != 'PARTEI' and rows[i - 1][0] == 'PARTEI') else 4 if kind != 'PARTEI' else 8
            for c in r:
                c.paragraphs[0].paragraph_format.space_before = Pt(gap)
    widths(t, LABEL_W, VALUE_W)


def render(text, path, title=None):
    items = parse(text)
    doc = Document()
    setup(doc)
    adressat = [t for k, t in items if k == 'ADRESSAT']
    az = [t for k, t in items if k == 'AZ' and t]
    head(doc, adressat, az)
    rows = []
    for k, t in items:
        label, bar, value = t.partition('|')
        if k == 'PARTEI':
            rows.append(('PARTEI', label.strip(), value.strip()))
        elif k in ('WEGEN', 'STREITWERT', 'RUBRUM'):
            default = {'WEGEN': 'wegen:', 'STREITWERT': 'Streitwert:', 'RUBRUM': ''}[k]
            rows.append((k, label.strip() if bar else default, value.strip() if bar else t))
    if rows:
        parties(doc, rows)
    for k, t in items:
        if k in ('ADRESSAT', 'AZ', 'PARTEI', 'WEGEN', 'STREITWERT', 'RUBRUM'):
            continue
        if k == 'TITEL':
            p = fmt(doc.add_paragraph(), before=24, after=4, align=WD_ALIGN_PARAGRAPH.CENTER, keep_next=True)
            r = p.add_run(t.upper())
            r.bold, r.font.size = True, Pt(14)
            r.font.color.rgb = RGBColor(0, 0, 0)
        elif k == 'UNTERTITEL':
            runs(fmt(doc.add_paragraph(), after=4, align=WD_ALIGN_PARAGRAPH.CENTER), t)
        elif k == 'BEILAGEN':
            label = t if t.lower().startswith('beilage') else 'Beilagen: ' + t
            runs(fmt(doc.add_paragraph(), after=18, align=WD_ALIGN_PARAGRAPH.CENTER), label, italic=True, size=10)
        elif k == 'H':
            runs(fmt(doc.add_paragraph(), before=12, after=6, keep_next=True), t, bold=True)
        elif k == 'P':
            p = doc.add_paragraph()
            m = re.match(r'^(\d+(?:\.\d+)*\.|[a-z]\))\s+(.*)$', t)
            if m:
                fmt(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY, left=0.75, first=-0.75)
                tab_stop(p, 0.75)
                p.add_run(m.group(1) + '\t')
                runs(p, m.group(2))
            else:
                runs(fmt(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY), t)
        elif k == 'BEWEIS':
            p = fmt(doc.add_paragraph(), after=8, left=3.0, first=-1.75)
            tab_stop(p, 3.0)
            items_ = [x.strip() for x in re.sub(r'^\s*Beweis:\s*', '', t).split(';') if x.strip()]
            p.add_run('Beweis:').bold = True
            p.add_run('\t')
            for i, it in enumerate(items_):
                if i:
                    p.add_run().add_break(WD_BREAK.LINE)
                runs(p, it)
        elif k == 'ANTRAG':
            lead = bool(re.fullmatch(r'[A-ZÄÖÜ ]{4,}[:,]?', t))  # e.g. "URTEILSBEGEHREN:"
            runs(fmt(doc.add_paragraph(), after=6, align=WD_ALIGN_PARAGRAPH.LEFT if lead else WD_ALIGN_PARAGRAPH.JUSTIFY, left=1.5, right=1.5, spacing=1.5, keep_next=lead), t, bold=lead)
        elif k == 'SCHLUSS':
            place, _, who = t.partition('|')
            fmt(doc.add_paragraph(), before=12, after=0)
            tbl = doc.add_table(rows=1, cols=2)
            borderless(tbl)
            widths(tbl, Cm(8.25), Cm(8.25))
            a, b = tbl.rows[0].cells
            cell_text(a, [place.strip()])
            cell_text(b, [x.strip() for x in who.split(';') if x.strip()] or [''], align=WD_ALIGN_PARAGRAPH.RIGHT)
    doc.core_properties.title = title or next((t for k, t in items if k == 'TITEL'), 'Schriftsatz')
    doc.save(path)
    return path


if __name__ == '__main__':
    import sys
    render(open(sys.argv[1], encoding='utf-8').read(), sys.argv[2])
