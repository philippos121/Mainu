"""Generate a clean, scientific HTML report for download.

Light theme, Inter font, summary-focused.
No interactive elements — pure reading for print/PDF.
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
    materialien = materialien or {}
    type_label = "Gesetze" if doc_type == "gesetze" else "Entscheidungen"
    changes_count = sum(1 for r in results[:50] if diffs.get(r.get("id", ""), {}).get("has_changes"))

    summary_html = _md_to_html(summary_md)

    # Build detailed results appendix
    appendix = ""
    groups: dict[str, list] = {}
    for r in results[:50]:
        key = r.get("title", "Sonstige")
        groups.setdefault(key, []).append(r)

    for group_name, group_results in groups.items():
        rows = ""
        for r in group_results:
            nor = r.get("id", "")
            artikel = _html.escape(str(r.get("artikel", "")))
            inkraft = _html.escape(str(r.get("date", "")))
            bgbl = _html.escape(str(r.get("bgbl", "")))
            url = _html.escape(str(r.get("url", "")))
            diff_data = diffs.get(nor, {})
            diff_html = ""
            if diff_data.get("has_changes") and diff_data.get("diff_html"):
                diff_html = f'<div class="diff">{diff_data["diff_html"]}</div>'

            rows += f'''<div class="row">
<div class="row-head">
  <span class="row-art">{artikel}</span>
  <span class="row-date">{inkraft}</span>
  <span class="row-bgbl">{bgbl}</span>
  {f'<a class="row-link" href="{url}" target="_blank">RIS →</a>' if url else ''}
</div>
{diff_html}
</div>'''

        # Materialien for this group
        mat_html = ""
        for r in group_results:
            bgbl_str = str(r.get("bgbl", "")) + " " + str(r.get("aenderung_bgbl", ""))
            for key, mat in materialien.items():
                if key in bgbl_str and mat.get("titel"):
                    purl = _html.escape(str(mat.get("parlament_url", "")))
                    mat_html = f'<p class="mat">{_html.escape(str(mat["titel"]))}'
                    if purl:
                        mat_html += f' — <a href="{purl}" target="_blank">Parlament</a>'
                    mat_html += '</p>'
                    break
            if mat_html:
                break

        appendix += f'''<div class="law-group">
<h3>{_html.escape(group_name)}</h3>
<p class="law-count">{len(group_results)} Bestimmung{"en" if len(group_results) > 1 else ""}</p>
{mat_html}
{rows}
</div>'''

    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legal Monitoring Report — {_html.escape(category)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Inter',system-ui,sans-serif;background:#fafbfc;color:#1a2a3a;line-height:1.6}}
.header{{padding:60px 24px 40px;text-align:center;border-bottom:1px solid #e8eaef}}
.header h1{{font-size:28px;font-weight:800;color:#0a5062;letter-spacing:-.5px;margin-bottom:4px}}
.header p{{font-size:14px;color:#6b7280}}
.header .stats{{display:flex;justify-content:center;gap:32px;margin-top:20px}}
.header .sn{{font-size:24px;font-weight:800;color:#007993;display:block}}
.header .sl{{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#9ca3af}}
.content{{max-width:640px;margin:0 auto;padding:48px 24px 80px}}
.section{{margin-bottom:40px}}
.section h2{{font-size:20px;font-weight:700;color:#0a5062;margin-bottom:12px;letter-spacing:-.3px}}
.section h3{{font-size:17px;font-weight:600;color:#1a3a4a;margin:20px 0 8px}}
.section h4{{font-size:15px;font-weight:600;color:#374151;margin:16px 0 6px}}
.section p{{font-size:14px;color:#4b5563;line-height:1.8;margin-bottom:10px}}
.section strong{{color:#1a2a3a}}
.section ul{{padding-left:18px;margin:8px 0 12px}}
.section li{{font-size:14px;color:#4b5563;margin-bottom:4px;line-height:1.7}}
.section a{{color:#007993;text-decoration:none}}
.section a:hover{{text-decoration:underline}}
.appendix-title{{font-size:18px;font-weight:700;color:#0a5062;margin:48px 0 20px;padding-top:24px;border-top:1px solid #e8eaef}}
.law-group{{margin-bottom:28px}}
.law-group h3{{font-size:15px;font-weight:700;color:#1a3a4a;margin:0 0 4px}}
.law-count{{font-size:12px;color:#9ca3af;margin:0 0 10px}}
.mat{{font-size:13px;color:#6d28d9;background:#f5f3ff;padding:8px 12px;border-radius:6px;margin-bottom:10px}}
.mat a{{color:#6d28d9;font-weight:600;text-decoration:none}}
.mat a:hover{{text-decoration:underline}}
.row{{padding:8px 0;border-bottom:1px solid #f0f1f4}}
.row:last-child{{border:none}}
.row-head{{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}}
.row-art{{font-weight:700;color:#1a2a3a}}
.row-date{{color:#6b7280}}
.row-bgbl{{color:#9ca3af;font-size:11px}}
.row-link{{color:#007993;text-decoration:none;font-size:11px;font-weight:500}}
.row-link:hover{{text-decoration:underline}}
.diff{{margin:8px 0;padding:10px;background:#fafbfc;border:1px solid #e8eaef;border-radius:6px;font-size:12px;line-height:1.6;max-height:200px;overflow-y:auto}}
.diff .diff-del{{background:#fecaca;color:#991b1b;text-decoration:line-through;padding:1px 2px;border-radius:2px}}
.diff .diff-ins{{background:#bbf7d0;color:#166534;padding:1px 2px;border-radius:2px}}
.diff .diff-info{{color:#6b7280;font-style:italic;margin-bottom:4px}}
.diff .diff-sidebyside{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}
.diff .diff-side{{padding:8px;border-radius:4px;font-size:11px;line-height:1.5}}
.diff .diff-side-old{{background:#fef2f2;border:1px solid #fecaca}}
.diff .diff-side-new{{background:#f0fdf4;border:1px solid #bbf7d0}}
.diff .diff-side-label{{font-weight:600;font-size:10px;text-transform:uppercase;margin-bottom:3px}}
.diff .diff-side-old .diff-side-label{{color:#991b1b}}
.diff .diff-side-new .diff-side-label{{color:#166534}}
.diff .diff-side-text{{white-space:pre-wrap}}
.footer{{text-align:center;padding:32px 24px;font-size:11px;color:#b0b8c0;border-top:1px solid #e8eaef}}
@media print{{.header{{padding:30px 0}}.content{{padding:20px 0}}body{{background:#fff}}}}
@media(max-width:640px){{.header h1{{font-size:22px}}.content{{padding:32px 16px}}}}
</style>
</head>
<body>
<div class="header">
  <h1>Legal Monitoring Report</h1>
  <p>{_html.escape(category)} · {_html.escape(timeframe)} · {date_str}</p>
</div>
<div class="content">
  <div class="section">
    {summary_html}
  </div>
  {f'<h2 class="appendix-title">Erfasste Bestimmungen</h2>' + appendix if appendix else ''}
</div>
<div class="footer">AI:ssociate Legal Monitoring · RIS · Findok · EUR-Lex · parlament.gv.at</div>
</body>
</html>'''


def _split_sections(md: str) -> list[dict]:
    """Split GPT markdown into sections by ## headings."""
    if not md:
        return [{"title": "Analyse", "body": "Keine Zusammenfassung verfügbar."}]

    parts = re.split(r'(?=^#{1,3}\s)', md, flags=re.MULTILINE)
    sections = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        lines = part.split('\n', 1)
        title = re.sub(r'^#+\s*', '', lines[0]).strip()
        body = lines[1].strip() if len(lines) > 1 else ''
        # Clean markdown formatting for plain text display
        body = re.sub(r'\*\*(.+?)\*\*', r'\1', body)
        body = re.sub(r'\*(.+?)\*', r'\1', body)
        body = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', body)  # remove links
        body = re.sub(r'^[-•]\s+', '· ', body, flags=re.MULTILINE)
        if title:
            sections.append({"title": title, "body": body})

    if not sections:
        return [{"title": "Analyse", "body": md[:600]}]
    return sections


def _js(s: str) -> str:
    """Escape string for JS string literal inside JSON."""
    return _html.escape(str(s)).replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ').replace('\r', '')


def _md_to_html(md: str) -> str:
    """Convert markdown to HTML (kept for email report compatibility)."""
    if not md:
        return "<p><em>Keine Zusammenfassung verfügbar.</em></p>"
    s = md
    s = re.sub(r'^#{3}\s+(.+)$', r'<h4>\1</h4>', s, flags=re.MULTILINE)
    s = re.sub(r'^#{2}\s+(.+)$', r'<h3>\1</h3>', s, flags=re.MULTILINE)
    s = re.sub(r'^#{1}\s+(.+)$', r'<h2>\1</h2>', s, flags=re.MULTILINE)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', s)
    s = re.sub(r'^[-•]\s+(.+)$', r'<li>\1</li>', s, flags=re.MULTILINE)
    s = re.sub(r'\n\n', '</p><p>', s)
    s = f'<p>{s}</p>'
    s = re.sub(r'((?:<li>.*?</li>\s*)+)', r'<ul>\1</ul>', s, flags=re.DOTALL)
    return s
