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
) -> str:
    diffs = diffs or {}
    type_label = "Gesetze" if doc_type == "gesetze" else "Entscheidungen"
    summary_html = _md_to_html(summary_md)

    # Group results by law (title)
    groups: dict[str, list] = {}
    for r in results[:50]:
        key = r.get("title", "Sonstige")
        groups.setdefault(key, []).append(r)

    # Build nav items + section cards
    nav_html = ""
    sections_html = ""
    changes_count = 0

    for gi, (group_name, group_results) in enumerate(groups.items()):
        safe_id = f"g{gi}"
        nav_html += f'<a class="nav-item" href="#" onclick="showSection(\'{safe_id}\');return false">{_html.escape(group_name)} <span class="nav-badge">{len(group_results)}</span></a>\n'

        cards = ""
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

    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rechtsänderungen — {_html.escape(category)}</title>
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
  .sidebar{{width:100%;position:relative;max-height:300px}}
  .main{{margin-left:0;padding:16px}}
}}
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-head">
    <svg width="160" height="36" viewBox="0 0 440 96" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:12px">
      <text x="0" y="72" font-family="'IBM Plex Sans',sans-serif" font-weight="800" font-size="72" font-style="italic" fill="#16a6c5">AI</text>
      <text x="88" y="72" font-family="'IBM Plex Sans',sans-serif" font-weight="300" font-size="72" fill="#ef6007">:</text>
      <text x="104" y="72" font-family="'IBM Plex Sans',sans-serif" font-weight="300" font-size="60" letter-spacing="5" fill="white">ssociate</text>
    </svg>
    <h1>{_html.escape(category)}</h1>
    <div class="sub">{_html.escape(timeframe)} · {date_str}</div>
  </div>
  <div class="sidebar-stats">
    <div class="sidebar-stat"><span class="num">{total_hits}</span><span class="lbl">{type_label}</span></div>
    <div class="sidebar-stat"><span class="num">{changes_count}</span><span class="lbl">Diffs</span></div>
  </div>
  <div class="nav-label">Übersicht</div>
  <a class="nav-item active" href="#" onclick="showSummary();return false">
    Rechtliche Analyse
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
        Rechtliche Analyse
      </div>
      {summary_html}
    </div>
  </div>
  {sections_html}
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
