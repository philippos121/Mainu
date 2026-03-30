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
.footer{{text-align:center;padding:32px 24px;font-size:11px;color:#b0b8c0;border-top:1px solid #e8eaef}}
@media print{{.header{{padding:30px 0}}.content{{padding:20px 0}}body{{background:#fff}}}}
@media(max-width:640px){{.header h1{{font-size:22px}}.content{{padding:32px 16px}}}}
</style>
</head>
<body>
<div class="header">
  <h1>Legal Monitoring Report</h1>
  <p>{_html.escape(category)} · {_html.escape(timeframe)} · {date_str}</p>
  <div class="stats">
    <div><span class="sn">{total_hits}</span><span class="sl">{type_label}</span></div>
    <div><span class="sn">{changes_count}</span><span class="sl">Änderungen</span></div>
  </div>
</div>
<div class="content">
  <div class="section">
    {summary_html}
  </div>
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
