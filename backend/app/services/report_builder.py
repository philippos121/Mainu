"""Generate premium interactive HTML reports for legal changes.

Features:
- Sidebar navigation with section links
- Animated section transitions
- Collapsible change cards with version diffs
- GPT summary in Austrian lawyer style
- Print-ready layout
"""

import html as _html
import re


def build_report(
    summary_md: str,
    results: list[dict],
    date_str: str,
    category: str,
    timeframe: str,
    total_hits: int,
    doc_type: str,
    diffs: dict = None,
    parliamentary: list[dict] = None,
    materialien: dict = None,
) -> str:
    diffs = diffs or {}
    parliamentary = parliamentary or []
    type_label = "Gesetze" if doc_type == "gesetze" else "Entscheidungen"
    summary_html = _md_to_html(summary_md)

    # Group results by law (title)
    groups: dict[str, list] = {}
    for r in results[:50]:
        key = r.get("title", "Sonstige")
        groups.setdefault(key, []).append(r)

    materialien = materialien or {}

    # Build nav items + section cards
    nav_html = ""
    sections_html = ""
    changes_count = 0

    for gi, (group_name, group_results) in enumerate(groups.items()):
        safe_id = f"g{gi}"
        nav_html += f'<a class="nav-item" href="#" onclick="showSection(\'{safe_id}\');return false">{_html.escape(group_name)} <span class="nav-badge">{len(group_results)}</span></a>\n'

        # Find matching Materialien for this group's BGBl numbers
        group_materialien = {}
        for r in group_results:
            bgbl = str(r.get("bgbl", ""))
            aenderung = str(r.get("aenderung_bgbl", ""))
            combined = f"{bgbl} {aenderung}"
            for key, mat in materialien.items():
                if key in combined:
                    group_materialien[key] = mat

        cards = ""

        # Show Materialien box at top of group if available
        for key, mat in group_materialien.items():
            mat_title = _html.escape(str(mat.get("titel", "")))
            mat_url = _html.escape(str(mat.get("parlament_url", "")))
            mat_rv = _html.escape(str(mat.get("rv_nr", "")))
            mat_gp = _html.escape(str(mat.get("gp", "")))
            mat_erl = _html.escape(str(mat.get("erlaeuterungen_url", "")))
            cards += f'''
<div class="card mat-card" style="animation-delay:0s">
  <div class="c-row" style="padding:12px 16px">
    <div class="c-info" style="flex:1">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#7c3aed;margin-bottom:4px">Gesetzesmaterialien</div>
      <div style="font-size:13px;font-weight:500;color:var(--text)">{_html.escape(key)}{f" — {mat_title}" if mat_title else ""}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">
        {f"RV {mat_rv} d.B. {mat_gp} GP" if mat_rv else ""}
        {f' · <a href="{mat_url}" target="_blank" style="color:#7c3aed;text-decoration:none">Parlament →</a>' if mat_url else ""}
        {f' · <a href="{mat_erl}" target="_blank" style="color:#7c3aed;text-decoration:none">Erläuterungen (PDF) →</a>' if mat_erl else ""}
      </div>
    </div>
  </div>
</div>'''

        for i, r in enumerate(group_results):
            nor = r.get("id", "")
            diff_data = diffs.get(nor, {})
            has_diff = bool(diff_data.get("diff_html"))
            if has_diff:
                changes_count += 1

            artikel = _html.escape(str(r.get("artikel", "")))
            typ = _html.escape(str(r.get("typ", "")))
            bgbl = _html.escape(str(r.get("bgbl", "")))
            inkraft = _html.escape(str(r.get("date", "")))
            url = _html.escape(str(r.get("url", "")))
            source = r.get("source", "")
            # Judikatur-specific fields
            court = _html.escape(str(r.get("court", "")))
            case_number = _html.escape(str(r.get("case_number", "")))
            normen = _html.escape(str(r.get("normen", "")))[:200]
            rechtssatz = _html.escape(str(r.get("rechtssatz", "")))[:400]

            prev_bar = ""
            if diff_data.get("previous"):
                pd = diff_data["previous"].get("date", "")
                prev_bar = f'<div class="ver-bar"><span class="ver-old">Vorversion: {_html.escape(pd)}</span><span class="ver-arrow">→</span><span class="ver-new">Neue Fassung: {inkraft}</span></div>'

            diff_box = ""
            if has_diff:
                diff_box = f'<div class="diff-box">{diff_data["diff_html"]}</div>'

            cards += f'''
<div class="card {'card-diff' if has_diff else ''}" style="animation-delay:{i*0.04}s">
  <div class="card-head" onclick="this.parentElement.classList.toggle('open')">
    <div class="card-info">
      <div class="card-top">
        {f'<span class="tag tag-typ">{typ}</span>' if typ else ''}
        {f'<span class="tag tag-court">{court}</span>' if court else ''}
        {f'<span class="tag tag-art">{artikel}</span>' if artikel else ''}
        {f'<span class="tag tag-art">{case_number}</span>' if case_number else ''}
        {'<span class="tag tag-chg">Geändert</span>' if has_diff else ''}
        {'<span class="tag tag-findok">Findok</span>' if source == 'findok' else ''}
        {'<span class="tag tag-eurlex">EUR-Lex</span>' if source == 'eurlex' else ''}
      </div>
      {f'<div class="card-rs">{rechtssatz}</div>' if rechtssatz else ''}
      <div class="card-dates">
        <span>{inkraft}</span>
        {f'<span class="card-bgbl">{bgbl}</span>' if bgbl else ''}
        {f'<span class="card-bgbl">Normen: {normen}</span>' if normen else ''}
      </div>
    </div>
    <svg class="chv" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
  </div>
  <div class="card-body">
    {prev_bar}
    {diff_box}
    <div class="card-foot">
      NOR: {_html.escape(nor)}
      {f' · <a href="{url}" target="_blank">Im RIS →</a>' if url else ''}
    </div>
  </div>
</div>'''

        sections_html += f'''
<div class="section" id="{safe_id}">
  <h2 class="section-title">{_html.escape(group_name)}</h2>
  <p class="section-count">{len(group_results)} Bestimmungen</p>
  {cards}
</div>'''

    # Add parliamentary materials section
    parl_html = ""
    if parliamentary:
        parl_cards = ""
        for i, p in enumerate(parliamentary):
            ptitle = _html.escape(str(p.get("title", "")))
            purl = _html.escape(str(p.get("url", "")))
            ptyp = _html.escape(str(p.get("typ", "")))
            pstelle = _html.escape(str(p.get("stelle", "")))
            parl_cards += f'''
<div class="card" style="animation-delay:{i*0.04}s">
  <div class="card-head" onclick="this.parentElement.classList.toggle('open')">
    <div class="card-info">
      <div class="card-top">
        <span class="tag" style="background:rgba(139,92,246,0.1);color:#7c3aed">{ptyp}</span>
        {f'<span class="tag tag-typ">{pstelle}</span>' if pstelle else ''}
      </div>
      <div style="font-size:13px;font-weight:500;color:#1a1a1a;margin-top:4px">{ptitle}</div>
    </div>
    <svg class="chv" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
  </div>
  <div class="card-body">
    {f'<a href="{purl}" target="_blank" style="color:#007993;font-size:13px;text-decoration:none">Im RIS anzeigen →</a>' if purl else ''}
  </div>
</div>'''

        nav_html += f'<div class="nav-label">Parlamentarische Materialien</div>\n'
        nav_html += f'<a class="nav-item" href="#" onclick="showSection(\'parl\');return false">Regierungsvorlagen / Begutachtung <span class="nav-badge">{len(parliamentary)}</span></a>\n'

        parl_html = f'''
<div class="section" id="parl">
  <h2 class="section-title">Parlamentarische Materialien</h2>
  <p class="section-count">Regierungsvorlagen und Begutachtungsentwürfe</p>
  {parl_cards}
</div>'''

    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Law Monitoring Report — {_html.escape(category)} — {date_str}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'IBM Plex Sans',sans-serif;background:#f5f6f8;color:#1a1a1a;display:flex;min-height:100vh}}

/* ── Sidebar ── */
.sidebar{{width:280px;background:#0a2e36;color:white;position:fixed;top:0;left:0;bottom:0;overflow-y:auto;display:flex;flex-direction:column;z-index:10}}
.sidebar-head{{padding:28px 20px 20px;border-bottom:1px solid rgba(255,255,255,0.1)}}
.sidebar-head h1{{font-size:16px;font-weight:700;margin-bottom:4px}}
.sidebar-head .sub{{font-size:12px;opacity:0.6}}
.sidebar-stats{{display:flex;gap:16px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.1)}}
.sidebar-stat{{text-align:center;flex:1}}
.sidebar-stat .num{{font-size:24px;font-weight:700;color:#ef6007;display:block}}
.sidebar-stat .lbl{{font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.5}}
.nav-label{{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.3);padding:16px 20px 8px;font-weight:600}}
.nav-item{{display:flex;justify-content:space-between;align-items:center;padding:10px 20px;font-size:13px;color:rgba(255,255,255,0.7);text-decoration:none;border-left:3px solid transparent;transition:all 0.15s}}
.nav-item:hover,.nav-item.active{{background:rgba(255,255,255,0.05);color:white;border-left-color:#ef6007}}
.nav-badge{{background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}}
.sidebar-foot{{margin-top:auto;padding:16px 20px;font-size:11px;opacity:0.3;border-top:1px solid rgba(255,255,255,0.1)}}

/* ── Main ── */
.main{{margin-left:280px;flex:1;padding:32px 40px;max-width:900px}}

/* ── Summary ── */
.summary{{background:white;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.04);margin-bottom:32px;animation:fadeUp 0.5s ease-out}}
.summary-head{{display:flex;align-items:center;gap:10px;margin-bottom:16px;color:#007993;font-weight:600;font-size:15px}}
.summary p{{font-size:14px;line-height:1.7;color:#374151;margin-bottom:10px}}
.summary h2{{font-size:16px;color:#007993;margin:18px 0 8px}}
.summary h3{{font-size:15px;color:#0f3d49;margin:14px 0 6px}}
.summary h4{{font-size:14px;color:#374151;margin:12px 0 4px}}
.summary strong{{color:#0f3d49}}
.summary ul{{padding-left:20px;margin:8px 0}}
.summary li{{font-size:14px;margin-bottom:4px;color:#374151}}

/* ── Sections ── */
.section{{display:none;animation:fadeUp 0.3s ease-out}}
.section.active{{display:block}}
.section-title{{font-size:20px;font-weight:700;color:#0f3d49;margin-bottom:4px}}
.section-count{{font-size:13px;color:#9ca3af;margin-bottom:20px}}

/* ── Cards ── */
.card{{background:white;border-radius:10px;margin-bottom:8px;border:1px solid #e5e7eb;overflow:hidden;animation:fadeUp 0.3s ease-out both;transition:border-color 0.2s}}
.card:hover{{border-color:#007993}}
.card-diff{{border-left:3px solid #007993}}
.card-head{{padding:14px 18px;cursor:pointer;display:flex;align-items:flex-start;gap:12px}}
.card-info{{flex:1;min-width:0}}
.card-top{{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}}
.tag{{padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600}}
.tag-typ{{background:rgba(0,121,147,0.08);color:#007993}}
.tag-art{{background:rgba(239,96,7,0.08);color:#ef6007}}
.tag-chg{{background:rgba(16,185,129,0.08);color:#059669}}
.tag-court{{background:rgba(99,102,241,0.08);color:#6366f1}}
.tag-findok{{background:rgba(234,88,12,0.08);color:#ea580c}}
.tag-eurlex{{background:rgba(37,99,235,0.08);color:#2563eb}}
.mat-card{{border-left:3px solid #7c3aed;background:#faf5ff}}
.card-rs{{font-size:12px;color:#4b5563;font-style:italic;border-left:2px solid #ef6007;padding-left:8px;margin:4px 0;line-height:1.5}}
.card-dates{{font-size:12px;color:#6b7280}}
.card-bgbl{{margin-left:8px;color:#9ca3af}}
.chv{{flex-shrink:0;margin-top:2px;color:#9ca3af;transition:transform 0.25s}}
.card.open .chv{{transform:rotate(180deg)}}
.card-body{{max-height:0;overflow:hidden;transition:max-height 0.35s ease,padding 0.35s ease;padding:0 18px;background:#fafafa;border-top:1px solid transparent}}
.card.open .card-body{{max-height:2000px;padding:16px 18px;border-top:1px solid #e5e7eb}}

/* ── Version bar ── */
.ver-bar{{display:flex;align-items:center;gap:8px;font-size:12px;padding:8px 12px;border-radius:6px;background:linear-gradient(90deg,#fef2f2,#f0fdf4);margin-bottom:12px}}
.ver-old{{color:#991b1b;font-weight:500}}
.ver-arrow{{color:#9ca3af}}
.ver-new{{color:#166534;font-weight:500}}

/* ── Diff ── */
.diff-box{{font-size:13px;line-height:1.8;padding:12px 16px;background:white;border:1px solid #e5e7eb;border-radius:8px;max-height:400px;overflow-y:auto;margin-bottom:12px}}
.diff-box .diff-del{{background:#fecaca;color:#991b1b;text-decoration:line-through;padding:1px 3px;border-radius:3px}}
.diff-box .diff-ins{{background:#bbf7d0;color:#166534;padding:1px 3px;border-radius:3px}}
.diff-box .diff-info{{color:#6b7280;font-style:italic;margin-bottom:8px}}
.diff-box .diff-sidebyside{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.diff-box .diff-side{{padding:10px;border-radius:6px;font-size:12px;line-height:1.6}}
.diff-box .diff-side-old{{background:#fef2f2;border:1px solid #fecaca}}
.diff-box .diff-side-new{{background:#f0fdf4;border:1px solid #bbf7d0}}
.diff-box .diff-side-label{{font-weight:600;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px}}
.diff-box .diff-side-old .diff-side-label{{color:#991b1b}}
.diff-box .diff-side-new .diff-side-label{{color:#166534}}
.diff-box .diff-side-text{{white-space:pre-wrap}}
.diff-box .diff-current{{color:#374151}}

.card-foot{{font-size:12px;color:#9ca3af;padding-top:10px;border-top:1px solid #e5e7eb}}
.card-foot a{{color:#007993;text-decoration:none}}
.card-foot a:hover{{text-decoration:underline}}

@keyframes fadeUp{{from{{opacity:0;transform:translateY(16px)}}to{{opacity:1;transform:translateY(0)}}}}

/* ── Print ── */
@media print{{
  .sidebar{{display:none}}
  .main{{margin-left:0;padding:20px}}
  .section{{display:block !important}}
  .card-body{{max-height:none !important;padding:12px 18px !important}}
  .chv{{display:none}}
  body{{background:white}}
  .diff-box{{max-height:none}}
}}
/* ── Mobile ── */
@media(max-width:768px){{
  .sidebar{{width:100%;position:relative;max-height:none;height:auto;border-bottom:1px solid rgba(255,255,255,0.1)}}
  .main{{margin-left:0;padding:16px}}
  .sidebar-head{{padding:20px 16px 12px}}
  .sidebar-head h1{{font-size:14px}}
  .sidebar-stats{{padding:10px 16px}}
  .nav-item{{padding:8px 16px;font-size:12px}}
  .card-head{{padding:12px 14px}}
  .diff-box{{font-size:12px;padding:10px}}
  .diff-box .diff-sidebyside{{grid-template-columns:1fr}}
  .summary{{padding:20px}}
  body{{font-size:14px}}
}}
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-head">
    <svg width="180" height="30" viewBox="0 0 770 126" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:12px">
      <mask id="m1" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="770" height="126"><path d="M769.855 0H0V125.04H769.855V0Z" fill="white"/></mask>
      <g mask="url(#m1)">
        <path d="M171.168 53.98H164.377V80.09H171.168V53.98Z" fill="rgba(255,255,255,0.5)"/>
        <path d="M171.168 98.84H164.377V124.95H171.168V98.84Z" fill="rgba(255,255,255,0.5)"/>
        <path d="M120.076 0H136.233V124.953H120.076V0Z" fill="rgba(255,255,255,0.5)"/>
        <path d="M50.706 0H69.803L120.075 124.953H101.366L50.706 0Z" fill="rgba(255,255,255,0.5)"/>
        <path d="M18.71 124.953H0L43.299 17.408L52.802 40.86L18.71 124.953Z" fill="white"/>
        <path d="M89.492 90.972H47.036L53.69 74.51H89.492V90.972Z" fill="rgba(255,255,255,0.5)"/>
        <path d="M247.6 46.24V56.75C241.86 52.71 234.09 50.4 227.39 50.4C218.18 50.4 210.89 54.77 210.89 62.4C210.89 69.54 217.11 73.02 228.35 77.63C240.79 82.82 252.02 87.79 252.02 101.52C252.02 115.26 239.95 124.95 223.31 124.95C213.85 124.95 205.12 121.96 199.38 117.92V106.49C205.49 111.68 214.44 115.61 222.94 115.61C232.74 115.61 240.77 110.31 240.77 101.87C240.77 94.27 233.95 90.8 221.87 85.72C210.64 80.99 199.97 76.03 199.97 62.99C199.97 49.96 211.35 40.95 227.14 40.95C234.91 40.95 242.34 43.15 247.6 46.24Z" fill="white"/>
        <path d="M318.18 46.24V56.75C312.44 52.71 304.67 50.4 297.97 50.4C288.76 50.4 281.47 54.77 281.47 62.4C281.47 69.54 287.69 73.02 298.92 77.63C311.37 82.82 322.6 87.79 322.6 101.52C322.6 115.26 310.52 124.95 293.89 124.95C284.43 124.95 275.7 121.96 269.96 117.92V106.49C276.07 111.68 285.02 115.61 293.52 115.61C303.32 115.61 311.34 110.31 311.34 101.87C311.34 94.27 304.53 90.8 292.45 85.72C281.22 80.99 270.55 76.03 270.55 62.99C270.55 49.96 281.92 40.95 297.72 40.95C305.49 40.95 312.92 43.15 318.18 46.24Z" fill="white"/>
        <path d="M425.97 82.93C425.97 106.93 406.94 125.04 382.67 125.04C358.4 125.04 339.37 106.93 339.37 82.93C339.37 58.93 358.4 40.93 382.67 40.93C406.94 40.93 425.97 59.04 425.97 82.93ZM349.99 82.93C349.99 101.39 364.71 115.24 382.65 115.24C400.58 115.24 415.31 101.39 415.31 82.93C415.31 64.47 400.72 50.73 382.65 50.73C364.58 50.73 349.99 64.58 349.99 82.93Z" fill="white"/>
        <path d="M510.17 118.23C504.8 122.38 495.59 125.04 486.25 125.04C461.95 125.04 443.18 106.93 443.18 82.93C443.18 58.93 462.07 40.93 485.52 40.93C494.25 40.93 501.79 42.77 508.6 46.46V57.08C501.79 53.04 494.13 50.73 486.48 50.73C467.81 50.73 453.82 64.69 453.82 82.93C453.82 103 469.25 115.24 487.43 115.24C495.45 115.24 503.45 112.47 510.15 107.5V118.23H510.17Z" fill="white"/>
        <path d="M532.16 42.31H542.44V123.66H532.16V42.31Z" fill="white"/>
        <path d="M593.17 42.31H604.07L637.09 123.66H626.33L616.87 100.23H580.39L570.93 123.66H560.29L593.2 42.31H593.17ZM613.5 90.88L598.66 53.28L583.72 90.88H613.5Z" fill="white"/>
        <path d="M661.59 51.43H635.63V42.31H697.71V51.43H671.86V123.66H661.59V51.43Z" fill="white"/>
        <path d="M716.73 42.31H768.42V51.43H727.04V78.09H761.38V87.21H727.04V114.56H769.85V123.68H716.73V42.31Z" fill="white"/>
      </g>
    </svg>
    <h1>Law Monitoring Report</h1>
    <div class="sub">{_html.escape(category)} · {_html.escape(timeframe)} · {date_str}</div>
  </div>
  <div class="sidebar-stats">
    <div class="sidebar-stat"><span class="num">{total_hits}</span><span class="lbl">{type_label}</span></div>
    <div class="sidebar-stat"><span class="num">{changes_count}</span><span class="lbl">Diffs</span></div>
  </div>
  <div class="nav-label">Übersicht</div>
  <a class="nav-item active" href="#" onclick="showSummary();return false">
    Analyse
  </a>
  <div class="nav-label">{type_label} nach Gesetz</div>
  {nav_html}
  <div class="sidebar-foot">
    Datenquelle: RIS · data.bka.gv.at<br>
    Erstellt am {date_str}
  </div>
</div>

<div class="main">
  <div class="section active" id="summary-section">
    <div class="summary">
      <div class="summary-head">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007993" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 12 18.469"/></svg>
        Analyse
      </div>
      {summary_html}
    </div>
  </div>
  {sections_html}
  {parl_html}
</div>

<script>
function showSection(id) {{
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  event.target.closest('.nav-item').classList.add('active');
}}
function showSummary() {{
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('summary-section').classList.add('active');
  document.querySelector('.nav-item').classList.add('active');
}}
</script>

</body>
</html>'''


def _md_to_html(md: str) -> str:
    if not md:
        return "<p><em>Keine Zusammenfassung verfügbar.</em></p>"
    s = md
    s = re.sub(r'^#{3}\s+(.+)$', r'<h4>\1</h4>', s, flags=re.MULTILINE)
    s = re.sub(r'^#{2}\s+(.+)$', r'<h3>\1</h3>', s, flags=re.MULTILINE)
    s = re.sub(r'^#{1}\s+(.+)$', r'<h2>\1</h2>', s, flags=re.MULTILINE)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
    s = re.sub(r'^[-•]\s+(.+)$', r'<li>\1</li>', s, flags=re.MULTILINE)
    s = re.sub(r'\n\n', '</p><p>', s)
    s = f'<p>{s}</p>'
    s = re.sub(r'((?:<li>.*?</li>\s*)+)', r'<ul>\1</ul>', s, flags=re.DOTALL)
    return s
