"""Generate a scroll-driven dark HTML report with neural network background.

Same visual style as the frontend: dark bg, teal nodes, text swaps on scroll.
Summary-focused — no long source lists, just concise analysis sections.
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

    # Split GPT summary into sections for slide-by-slide display
    sections = _split_sections(summary_md)

    # Build slides JSON for the JS scroll driver
    slides_json = '['
    # Slide 0: title
    slides_json += f'{{"t":"{_js(category)}","s":"{_js(timeframe)} · {_js(date_str)}","cls":"hero"}},'
    slides_json += f'{{"t":"{total_hits} Rechtsakte analysiert","s":"{len(diffs)} Änderungen · {len(materialien)} Materialien","cls":"stat"}},'
    # Summary sections as slides
    for sec in sections:
        title = _js(sec["title"])
        body = _js(sec["body"][:600])
        slides_json += f'{{"t":"{title}","s":"{body}","cls":"analysis"}},'
    slides_json += '{"t":"Report vollständig.","s":"","cls":"end"}'
    slides_json += ']'

    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legal Monitoring — {_html.escape(category)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Inter',system-ui,sans-serif;background:#070e12;color:#e4f0f2;overflow-x:hidden}}
canvas{{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;contain:strict}}
.stage{{position:fixed;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none}}
.stage-text{{text-align:center;max-width:640px;padding:0 32px;transition:opacity .3s ease,transform .3s ease;will-change:opacity,transform}}
.st-title{{font-size:36px;font-weight:700;color:rgba(255,255,255,.85);letter-spacing:-.5px;margin:0;line-height:1.2}}
.st-title.hero{{font-size:42px;font-weight:800;background:linear-gradient(135deg,#ff9733,#ffbe6d 40%,#ff9733 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}}
.st-title.stat{{font-size:28px;font-weight:300;color:rgba(255,255,255,.5)}}
.st-title.analysis{{font-size:26px;font-weight:700;color:#22c9e8;margin-bottom:16px}}
.st-title.end{{font-size:24px;font-weight:300;color:rgba(255,255,255,.4)}}
.st-sub{{font-size:15px;font-weight:400;color:rgba(255,255,255,.45);margin-top:12px;line-height:1.7;max-height:50vh;overflow-y:auto}}
.st-sub.hero{{font-size:16px;color:rgba(255,255,255,.3)}}
.st-sub.stat{{font-size:22px;color:rgba(34,201,232,.5);letter-spacing:1px}}
.st-sub.analysis{{font-size:14px;color:rgba(255,255,255,.5);text-align:left;line-height:1.8}}
.scroll-driver{{position:relative;z-index:1;pointer-events:none}}
@media(max-width:640px){{.st-title{{font-size:26px}}.st-title.hero{{font-size:30px}}.st-title.analysis{{font-size:22px}}.st-sub.analysis{{font-size:13px}}}}
@media print{{body{{background:#fff;color:#1a1a1a}}canvas{{display:none}}.stage{{position:static;display:block}}.scroll-driver{{display:none}}.st-title,.st-sub{{color:#1a1a1a!important;-webkit-text-fill-color:#1a1a1a!important}}}}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div class="stage"><div class="stage-text" id="st">
  <h2 class="st-title" id="st-t"></h2>
  <p class="st-sub" id="st-s"></p>
</div></div>
<div class="scroll-driver" id="drv"></div>
<script>
(function(){{
  const slides={slides_json};
  const SH=500,drv=document.getElementById('drv');
  drv.style.height=(slides.length*SH+innerHeight)+'px';
  const st=document.getElementById('st'),tt=document.getElementById('st-t'),ss=document.getElementById('st-s');
  let prev=-1;

  // Canvas
  const c=document.getElementById('c'),g=c.getContext('2d',{{alpha:false}});
  let W,H;const N=50,D=170*170;
  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N);
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N);
  const sr=new Float32Array(N),ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N);
  for(let i=0;i<N;i++){{ax[i]=Math.random()*2.6-1.3;ay[i]=Math.random()*2.6-1.3;az[i]=Math.random()*2.6-1.3;dx[i]=(Math.random()-.5)*.001;dy[i]=(Math.random()-.5)*.001;dz[i]=(Math.random()-.5)*.0008;sr[i]=1.2+Math.random()*1.8}}
  function resize(){{W=c.width=innerWidth;H=c.height=innerHeight}}
  resize();addEventListener('resize',resize);

  function draw(sY,moving){{
    const ry=sY*.00025,rx=sY*.00015;
    const cy=Math.cos(ry),sn=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx),hw=W/2,hh=H/2;
    if(moving)for(let i=0;i<N;i++){{ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i];if(ax[i]>1.3||ax[i]<-1.3)dx[i]*=-1;if(ay[i]>1.3||ay[i]<-1.3)dy[i]*=-1;if(az[i]>1.3||az[i]<-1.3)dz[i]*=-1}}
    for(let i=0;i<N;i++){{const x=ax[i],y=ay[i],z=az[i],a=x*cy-z*sn,b=x*sn+z*cy,d=y*cx-b*sx,e=y*sx+b*cx,s=2.5/(4+e);ox[i]=hw+a*W*.36*s;oy[i]=hh+d*H*.3*s;os[i]=s}}
    g.fillStyle='#070e12';g.fillRect(0,0,W,H);
    g.beginPath();g.strokeStyle='rgba(34,201,232,0.06)';g.lineWidth=.5;
    for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){{const a=ox[i]-ox[j],b=oy[i]-oy[j];if(a*a+b*b<D){{g.moveTo(ox[i],oy[i]);g.lineTo(ox[j],oy[j])}}}}
    g.stroke();
    for(let i=0;i<N;i++){{const r=sr[i]*os[i],a=.2+os[i]*.4;g.beginPath();g.arc(ox[i],oy[i],r*3,0,6.28);g.fillStyle='rgba(34,201,232,'+(a*.05)+')';g.fill();g.beginPath();g.arc(ox[i],oy[i],r,0,6.28);g.fillStyle='rgba(34,201,232,'+(a*.5)+')';g.fill()}}
  }}
  draw(0,false);

  let scrolling=false,timer=0,raf=0;
  function loop(){{if(!scrolling)return;draw(scrollY,true);raf=requestAnimationFrame(loop)}}
  addEventListener('scroll',function(){{
    if(!scrolling){{scrolling=true;loop()}}
    clearTimeout(timer);timer=setTimeout(function(){{scrolling=false}},150);
    const idx=Math.min(slides.length-1,Math.floor(scrollY/SH));
    if(idx===prev)return;prev=idx;
    const sl=slides[idx];
    st.style.opacity='0';st.style.transform='translateY(20px)';
    setTimeout(function(){{
      tt.textContent=sl.t;tt.className='st-title '+(sl.cls||'');
      ss.textContent=sl.s;ss.className='st-sub '+(sl.cls||'');
      ss.style.display=sl.s?'block':'none';
      st.style.opacity='1';st.style.transform='translateY(0)';
    }},150);
  }},{{passive:true}});
}})();
</script>
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
