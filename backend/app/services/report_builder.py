"""Generate a clean, scientific HTML report for legal changes.

Light theme, parallax scroll, summary-focused.
No interactive elements — pure reading experience for download.
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
    materialien = materialien or {}
    summary_html = _md_to_html(summary_md)
    type_label = "Gesetze" if doc_type == "gesetze" else "Entscheidungen"

    # Count changes
    changes_count = sum(1 for r in results[:50] if diffs.get(r.get("id", ""), {}).get("has_changes"))

    # Build result sections grouped by law
    groups: dict[str, list] = {}
    for r in results[:50]:
        key = r.get("title", "Sonstige")
        groups.setdefault(key, []).append(r)

    sections_html = ""
    for gi, (group_name, group_results) in enumerate(groups.items()):
        # Find materialien for this group
        mat_html = ""
        for r in group_results:
            bgbl = str(r.get("bgbl", ""))
            aenderung = str(r.get("aenderung_bgbl", ""))
            combined = f"{bgbl} {aenderung}"
            for key, mat in materialien.items():
                if key in combined and mat.get("titel"):
                    mat_html += f'<p class="mat">Materialien: {_html.escape(str(mat.get("titel", "")))} '
                    if mat.get("parlament_url"):
                        mat_html += f'<a href="{_html.escape(str(mat["parlament_url"]))}" target="_blank">Parlament →</a>'
                    mat_html += '</p>'
                    break
            if mat_html:
                break

        provisions = ""
        for r in group_results:
            nor = r.get("id", "")
            diff_data = diffs.get(nor, {})
            has_diff = bool(diff_data.get("diff_html"))
            artikel = _html.escape(str(r.get("artikel", "")))
            inkraft = _html.escape(str(r.get("date", "")))
            bgbl = _html.escape(str(r.get("bgbl", "")))
            url = _html.escape(str(r.get("url", "")))
            source = r.get("source", "")
            source_tag = ""
            if source == "findok":
                source_tag = '<span class="src-tag findok">Findok</span>'
            elif source == "eurlex":
                source_tag = '<span class="src-tag eurlex">EUR-Lex</span>'

            diff_html = ""
            if has_diff:
                diff_html = f'<div class="diff">{diff_data["diff_html"]}</div>'

            provisions += f'''<div class="provision{' has-diff' if has_diff else ''}">
<div class="prov-head">
  <span class="prov-art">{artikel}</span>
  <span class="prov-date">{inkraft}</span>
  {f'<span class="prov-bgbl">{bgbl}</span>' if bgbl else ''}
  {source_tag}
  {f'<a class="prov-link" href="{url}" target="_blank">Quelle →</a>' if url else ''}
</div>
{diff_html}
</div>'''

        sections_html += f'''
<section class="law-group" style="--delay:{gi * 0.05}s">
  <h3 class="law-title">{_html.escape(group_name)}</h3>
  <p class="law-count">{len(group_results)} Bestimmung{"en" if len(group_results) > 1 else ""}</p>
  {mat_html}
  {provisions}
</section>'''

    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legal Monitoring — {_html.escape(category)} — {date_str}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Inter',system-ui,sans-serif;background:#f8f9fb;color:#1a1f2e;line-height:1.6}}

/* ── Hero parallax ── */
.hero{{
  min-height:60vh;display:flex;align-items:center;justify-content:center;text-align:center;
  background:linear-gradient(180deg,#0a1e28 0%,#0d2a38 60%,#f8f9fb 100%);
  color:white;padding:80px 24px 120px;position:relative;
}}
.hero-inner{{max-width:600px}}
.hero h1{{font-size:32px;font-weight:800;letter-spacing:-1px;margin-bottom:8px}}
.hero .accent{{color:#22c9e8}}
.hero .meta{{font-size:14px;opacity:.5;margin-top:12px}}
.hero .stats{{display:flex;justify-content:center;gap:40px;margin-top:28px}}
.hero .stat-n{{font-size:28px;font-weight:800;color:#ff9733;display:block}}
.hero .stat-l{{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;opacity:.4}}

/* ── Content ── */
.content{{max-width:720px;margin:-40px auto 0;padding:0 24px 80px;position:relative;z-index:1}}

/* ── Summary card ── */
.summary-card{{
  background:white;border-radius:16px;padding:36px;
  box-shadow:0 4px 24px rgba(0,0,0,.06);margin-bottom:48px;
}}
.summary-label{{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#007993;margin-bottom:20px}}
.summary-card p{{font-size:15px;line-height:1.8;color:#374151;margin-bottom:12px}}
.summary-card h2{{font-size:18px;font-weight:700;color:#0a1e28;margin:28px 0 10px}}
.summary-card h3{{font-size:16px;font-weight:600;color:#1a2a3a;margin:22px 0 8px}}
.summary-card h4{{font-size:14px;font-weight:600;color:#374151;margin:18px 0 6px}}
.summary-card strong{{color:#0a1e28}}
.summary-card ul{{padding-left:20px;margin:8px 0}}
.summary-card li{{font-size:14px;margin-bottom:6px;color:#374151}}
.summary-card a{{color:#007993;text-decoration:none}}
.summary-card a:hover{{text-decoration:underline}}

/* ── Law groups ── */
.law-group{{margin-bottom:40px;padding-top:24px;border-top:1px solid #e8eaef}}
.law-title{{font-size:18px;font-weight:700;color:#0a1e28;letter-spacing:-.3px}}
.law-count{{font-size:12px;color:#9ca3af;margin-bottom:12px}}
.mat{{font-size:13px;color:#7c3aed;margin-bottom:12px;padding:10px 14px;background:#f5f3ff;border-radius:8px}}
.mat a{{color:#7c3aed;text-decoration:none;font-weight:600}}
.mat a:hover{{text-decoration:underline}}

.provision{{padding:12px 0;border-bottom:1px solid #f0f1f4}}
.provision:last-child{{border:none}}
.has-diff{{border-left:3px solid #007993;padding-left:12px;margin-left:-12px}}
.prov-head{{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}}
.prov-art{{font-weight:700;color:#0a1e28}}
.prov-date{{color:#6b7280}}
.prov-bgbl{{color:#9ca3af;font-size:12px}}
.prov-link{{color:#007993;text-decoration:none;font-weight:500;font-size:12px}}
.prov-link:hover{{text-decoration:underline}}
.src-tag{{font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px}}
.src-tag.findok{{background:#fff7ed;color:#ea580c}}
.src-tag.eurlex{{background:#eff6ff;color:#2563eb}}

.diff{{
  margin-top:10px;padding:14px;background:#fafbfc;border:1px solid #e8eaef;
  border-radius:8px;font-size:13px;line-height:1.7;
  max-height:300px;overflow-y:auto;
}}
.diff .diff-del{{background:#fecaca;color:#991b1b;text-decoration:line-through;padding:1px 3px;border-radius:2px}}
.diff .diff-ins{{background:#bbf7d0;color:#166534;padding:1px 3px;border-radius:2px}}
.diff .diff-info{{color:#6b7280;font-style:italic;margin-bottom:6px}}
.diff .diff-sidebyside{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.diff .diff-side{{padding:10px;border-radius:6px;font-size:12px;line-height:1.5}}
.diff .diff-side-old{{background:#fef2f2;border:1px solid #fecaca}}
.diff .diff-side-new{{background:#f0fdf4;border:1px solid #bbf7d0}}
.diff .diff-side-label{{font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}}
.diff .diff-side-old .diff-side-label{{color:#991b1b}}
.diff .diff-side-new .diff-side-label{{color:#166534}}
.diff .diff-side-text{{white-space:pre-wrap}}

/* ── Footer ── */
.footer{{text-align:center;padding:40px 24px;font-size:11px;color:#9ca3af}}
.footer a{{color:#007993;text-decoration:none}}

@media print{{
  .hero{{min-height:auto;padding:40px 24px;background:#0a1e28!important;-webkit-print-color-adjust:exact}}
  .diff{{max-height:none}}
  body{{background:white}}
}}
@media(max-width:640px){{
  .hero h1{{font-size:24px}}
  .summary-card{{padding:24px}}
  .diff .diff-sidebyside{{grid-template-columns:1fr}}
}}
</style>
</head>
<body>

<div class="hero">
  <div class="hero-inner">
    <h1>Legal Monitoring <span class="accent">Report</span></h1>
    <p>{_html.escape(category)} · {_html.escape(timeframe)}</p>
    <p class="meta">Erstellt am {date_str}</p>
    <div class="stats">
      <div><span class="stat-n">{total_hits}</span><span class="stat-l">{type_label}</span></div>
      <div><span class="stat-n">{changes_count}</span><span class="stat-l">Änderungen</span></div>
      <div><span class="stat-n">{len(materialien)}</span><span class="stat-l">Materialien</span></div>
    </div>
  </div>
</div>

<div class="content">
  <div class="summary-card">
    <p class="summary-label">KI-Analyse</p>
    {summary_html}
  </div>

  {sections_html}
</div>

<div class="footer">
  AI:ssociate Legal Monitoring · Datenquellen: RIS · Findok · EUR-Lex · parlament.gv.at
</div>

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
    # Markdown links [text](url)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', s)
    s = re.sub(r'^[-•]\s+(.+)$', r'<li>\1</li>', s, flags=re.MULTILINE)
    s = re.sub(r'\n\n', '</p><p>', s)
    s = f'<p>{s}</p>'
    s = re.sub(r'((?:<li>.*?</li>\s*)+)', r'<ul>\1</ul>', s, flags=re.DOTALL)
    return s
