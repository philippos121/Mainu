// Records the explainer video: real server.js + UI against demo backends, CDP screencast frames,
// scenes paced by the narration clips. Writes frames/ and timeline.json.
const { chromium } = require('playwright')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { modelServer, kbServer, risServer } = require('./mocks.cjs')
const ROOT = path.resolve(__dirname, '../..')
const { Document, Packer, Paragraph } = require(path.join(ROOT, 'node_modules/docx'))

const DIR = __dirname
const FRAMES = path.join(DIR, 'frames')
const DUR = JSON.parse(fs.readFileSync(path.join(DIR, 'audio/durations.json'), 'utf8'))
const NARR = JSON.parse(fs.readFileSync(path.join(DIR, 'narration.json'), 'utf8'))
const PORT = 3950, BASE = `http://127.0.0.1:${PORT}`
const OWNER = 'w_demo0000000000000000000000000001'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

const OVERLAY = () => {
  const boot = () => {
    if (window.__demo) return
    const st = document.createElement('style')
    st.textContent = `
      #demoCursor { position: fixed; z-index: 100000; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none; transform: translate(-3px, -2px); transition: opacity .2s; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      .demo-ripple { position: fixed; z-index: 99999; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid rgba(243,146,0,.9); pointer-events: none; animation: demoRip .5s ease-out forwards; }
      @keyframes demoRip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
      #demoSpot { position: fixed; z-index: 99990; pointer-events: none; border-radius: 12px; box-shadow: 0 0 0 3px rgba(243,146,0,.95), 0 0 0 9999px rgba(14,37,46,.42); opacity: 0; transition: opacity .35s, left .4s ease, top .4s ease, width .4s ease, height .4s ease; }
      #demoPill { position: fixed; z-index: 99995; right: 22px; top: 68px; transform: translate(0, -8px); background: #0e3c46; color: #fff; font: 700 13px/1 'Plus Jakarta Sans', system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; padding: 9px 16px; border-radius: 999px; box-shadow: 0 8px 24px rgba(14,37,46,.3); opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; }
      #demoPill b { color: #f39200; margin-right: 8px; }
      #demoPill.show { opacity: 1; transform: translate(0, 0); }
      #demoCard { position: fixed; inset: 0; z-index: 99998; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 18px; background: radial-gradient(1200px 600px at 50% 40%, #13606c 0%, #0e3c46 55%, #0a2a31 100%); color: #fff; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; text-align: center; opacity: 0; transition: opacity .6s; pointer-events: none; }
      #demoCard.show { opacity: 1; }
      #demoCard .logo { background: #fff; border-radius: 18px; padding: 18px 28px; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
      #demoCard .logo img { height: 54px; display: block; }
      #demoCard h1 { margin: 6px 0 0; font-size: 40px; font-weight: 800; letter-spacing: -.01em; }
      #demoCard p { margin: 0; font-size: 19px; color: rgba(255,255,255,.82); max-width: 760px; line-height: 1.45; }
      #demoCard .tag { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #f39200; font-weight: 800; }
    `
    document.head.appendChild(st)
    const cur = document.createElement('div'); cur.id = 'demoCursor'
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.6-6.8L4 20z" fill="#fff" stroke="#0e252e" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    document.body.appendChild(cur)
    document.addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px' }, true)
    const ripple = (x, y) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600) }
    document.addEventListener('mousedown', (e) => ripple(e.clientX, e.clientY), true)
    const spot = document.createElement('div'); spot.id = 'demoSpot'; document.body.appendChild(spot)
    const pill = document.createElement('div'); pill.id = 'demoPill'; document.body.appendChild(pill)
    const card = document.createElement('div'); card.id = 'demoCard'; document.body.appendChild(card)
    let spotSel = null, pillT = 0
    const loop = () => {
      if (spotSel) {
        const els = [].concat(spotSel).map((q) => document.querySelector(q)).filter((e) => e && e.offsetParent !== null)
        if (els.length) {
          const rs = els.map((e) => e.getBoundingClientRect()); const pad = 7
          const l = Math.min(...rs.map((r) => r.left)) - pad, t = Math.min(...rs.map((r) => r.top)) - pad
          const w = Math.max(...rs.map((r) => r.right)) - l + pad, h = Math.max(...rs.map((r) => r.bottom)) - t + pad
          Object.assign(spot.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', opacity: 1 })
        } else spot.style.opacity = 0
      } else spot.style.opacity = 0
      requestAnimationFrame(loop)
    }
    loop()
    window.__demo = {
      ripple,
      spot(sel) { spotSel = sel },
      pill(no, text) { pill.innerHTML = `<b>${no}</b>${text}`; pill.classList.add('show'); clearTimeout(pillT); pillT = setTimeout(() => pill.classList.remove('show'), 3200) },
      card(html) { card.innerHTML = html; card.classList.add('show') },
      hideCard() { card.classList.remove('show') },
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot()
}

async function docx(paragraphs) {
  return (await Packer.toBuffer(new Document({ sections: [{ children: paragraphs.map((t) => new Paragraph(t)) }] }))).toString('base64')
}

;(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true })
  const servers = [[modelServer(), 3951], [kbServer(), 3952], [risServer(), 3953]]
  for (const [s, p] of servers) await new Promise((r) => s.listen(p, r))
  const data = fs.mkdtempSync(path.join(DIR, 'data_'))
  let log = ''
  const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), AUTH: 'off', DATA_DIR: data, OPENAI_API_KEY: 'sk-demo', OPENAI_BASE_URL: 'http://127.0.0.1:3951/v1', AISSOCIATE_BASE_URL: 'http://127.0.0.1:3952', AISSOCIATE_API_KEY: 'ck:demo', RIS_BASE_URL: 'http://127.0.0.1:3953', RIS_TIMEOUT_MS: '5000', MS_CLIENT_ID: 'demo', MS_CLIENT_SECRET: 'demo', AZURE_OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch {} await sleep(250) }

  // ---- seed: one due diligence (run against the demo backends) and two Akten ----
  const api = async (p, o = {}) => { const r = await fetch(BASE + p, { ...o, headers: { 'Content-Type': 'application/json', 'X-Owner-Key': OWNER } }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
  const b64 = (s) => Buffer.from(s).toString('base64')
  const dd = (await api('/api/matters', { method: 'POST', body: JSON.stringify({ name: 'Projekt Edelweiß', kind: 'dd', client: 'Käufer Holding AG', settings: { target: 'Alpentech GmbH', areas: ['vertraege', 'immobilien', 'arbeit'] } }) })).matter
  await api(`/api/matters/${dd.id}/documents`, { method: 'POST', body: JSON.stringify({ files: [
    { name: 'Liefervertrag Großkunde Alpenstahl.txt', base64: b64('Rahmenliefervertrag zwischen Alpentech GmbH (Lieferantin) und Alpenstahl AG (Kundin).\nPunkt 9.2: Die Haftung der Kundin ist mit dem jährlichen Auftragswert begrenzt.\nPunkt 12.3: Bei einem Wechsel der Kontrolle über die Lieferantin ist die Kundin berechtigt, den Vertrag mit sofortiger Wirkung zu kündigen.') },
    { name: 'Mietvertrag Betriebsliegenschaft Linz.txt', base64: b64('Mietvertrag zwischen Linzer Gewerbepark GmbH (Vermieterin) und Alpentech GmbH (Mieterin) über die Produktionshalle Linz.\nPunkt 3: Das Mietverhältnis ist bis 31.12.2027 befristet. Eine Verlängerungsoption ist nicht vereinbart.\nPunkt 8: Untervermietung und Weitergabe bedürfen der Zustimmung der Vermieterin.') },
    { name: 'Geschäftsführervertrag DI Berger.txt', base64: b64('Geschäftsführervertrag zwischen Alpentech GmbH und DI Anna Berger.\nPunkt 6: Im Fall eines Kontrollwechsels steht der Geschäftsführerin eine Abfertigung in Höhe von 24 Monatsentgelten zu.') },
  ] }) })
  const run = await api(`/api/matters/${dd.id}/dd/run`, { method: 'POST', body: '{}' })
  for (let i = 0; i < 240; i++) { const m = (await api(`/api/matters/${dd.id}`)).matter; if (!m.job?.running && ['done', 'error'].includes(m.job?.status)) { console.log('DD', m.job.status, m.findings.length, 'findings', m.job.error || ''); break } await sleep(500) }
  for (const [name, client, files] of [['Huber gegen Meier', 'Maria Huber', [['Klage Schadenersatz.txt', 'Klage auf Schadenersatz wegen eines Wasserschadens vom 12.05.2024.'], ['Schreiben Gegenseite.txt', 'Die beklagte Partei bestreitet die Haftung dem Grunde nach.']]], ['Verlassenschaft Gruber', 'Familie Gruber', [['Testament.txt', 'Letztwillige Verfügung des Johann Gruber.']]]]) {
    const m = (await api('/api/matters', { method: 'POST', body: JSON.stringify({ name, kind: 'matter', client }) })).matter
    await api(`/api/matters/${m.id}/documents`, { method: 'POST', body: JSON.stringify({ files: files.map(([n, t]) => ({ name: n, base64: b64(t) })) }) })
  }
  void run

  // ---- folder of the client (written into the browser's origin-private file system) ----
  const folderFiles = [
    { path: 'Mietsache/Mietvertrag Wien.docx', b64: await docx(['Mietvertrag über das Geschäftslokal Wien 7., Neubaugasse 12', 'Vermieterin: Neubau Immobilien GmbH · Mieterin: Maria Huber e.U.', 'Punkt 5: Der Mietzins ist wertgesichert nach dem VPI 2020.', 'Punkt 7: Kündigung. Die Mieterin kann den Vertrag unter Einhaltung einer dreimonatigen Frist zum Ende jedes Kalendervierteljahres kündigen. Die Vermieterin verzichtet für die ersten fünf Jahre auf ihr Kündigungsrecht; danach kann sie nur aus wichtigen Gründen im Sinne des § 30 MRG kündigen. Jede Kündigung bedarf der Schriftform.']) },
    { path: 'Mietsache/Kaufvertrag Inventar.docx', b64: await docx(['Kaufvertrag über das Inventar', 'Der Kaufpreis beträgt 18.000 EUR.']) },
    { path: 'Korrespondenz/Schreiben Hausverwaltung 2024-03.txt', b64: b64('Sehr geehrte Frau Huber, wir übermitteln die Betriebskostenabrechnung 2023.') },
    { path: 'Korrespondenz/Mail Steuerberater.txt', b64: b64('Die Umsatzsteuervoranmeldung für das erste Quartal ist eingereicht.') },
    { path: 'Notizen/Telefonnotiz 2024-04-02.txt', b64: b64('Mandantin fragt, ob sie das Lokal vorzeitig aufgeben kann.') },
  ]

  // ---- browser ----
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, locale: 'de-AT' })
  await ctx.addInitScript(([owner]) => { try { localStorage.setItem('aiss.owner.v1', owner); localStorage.setItem('aiss.tourSeen.v3', '1') } catch {} }, [OWNER])
  await ctx.addInitScript(OVERLAY)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => window.__demo.card(`<div class="logo"><img src="/aissociate-logo.png" alt=""></div><div class="tag">Playground</div><h1>Die Funktionen im Überblick</h1><p>Juristische KI für österreichisches Recht – Recherche, Dokumente, Fachagenten und Due Diligence.</p>`))
  await sleep(900)

  const frames = []
  const cdp = await ctx.newCDPSession(page)
  let n = 0
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(FRAMES, `f${String(n++).padStart(5, '0')}.jpg`)
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'))
    frames.push({ file, ts: f.metadata.timestamp })
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
  const t0 = now()
  // keep frames flowing while the screen is static (the screencast only sends changes)
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:.01;z-index:100001;pointer-events:none'; document.body.appendChild(d); let k = 0; setInterval(() => { d.style.background = (k++ % 2) ? '#000' : '#fff' }, 100) })

  // ---- helpers ----
  let mx = 640, my = 400
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
  async function moveTo(sel, { dx = 0, dy = 0, ms = 650 } = {}) {
    const loc = page.locator(sel).first()
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    const b = await loc.boundingBox(); if (!b) { console.log('no box', sel); return }
    const x = b.x + b.width / 2 + dx, y = b.y + b.height / 2 + dy
    const steps = Math.max(10, Math.round(ms / 16)), sx = mx, sy = my
    for (let i = 1; i <= steps; i++) { const t = ease(i / steps); await page.mouse.move(sx + (x - sx) * t, sy + (y - sy) * t); await sleep(14) }
    mx = x; my = y
  }
  async function click(sel, opts = {}) { await moveTo(sel, opts); await sleep(160); await page.mouse.down(); await sleep(90); await page.mouse.up(); await sleep(250) }
  async function type(text, delay = 42) { for (const ch of text) { await page.keyboard.type(ch); await sleep(delay + Math.random() * 30) } }
  const spot = (sel) => page.evaluate((s) => window.__demo.spot(s), sel)
  const timeline = []
  let sceneNo = 0
  async function scene(id, fn) {
    const s = NARR.find((x) => x.id === id)
    const start = now()
    timeline.push({ id, start: start - t0, dur: DUR[id], chapter: s.chapter, text: s.text })
    const at = async (frac) => { const t = start + DUR[id] * frac - now(); if (t > 0) await sleep(t * 1000) }
    await fn(at)
    const rest = start + DUR[id] + 0.8 - now()
    if (rest > 0) await sleep(rest * 1000)
    else console.log(`scene ${id} ran ${(-rest).toFixed(1)}s past its narration`)
    sceneNo++
  }
  const pill = (no, text) => page.evaluate(([a, b]) => window.__demo.pill(a, b), [no, text])

  // ---- scenes ----
  await scene('intro', async () => {})
  await page.evaluate(() => window.__demo.hideCard()); await sleep(700)

  await scene('kb', async (at) => {
    await pill('1', 'Fragen stellen')
    await spot('#kbList')
    await moveTo('#kbList', { dx: -150, dy: -40 })
    await at(0.45)
    await click('#kbList >> text=Zivilrecht')
    await at(0.75)
    await moveTo('#kbList >> text=Öffentliches Recht', { ms: 500 })
    await moveTo('#kbList select', { ms: 500 })
  })
  await scene('templates', async () => {
    await spot('#homeChips')
    await moveTo('#homeChips button >> nth=0', { ms: 500 }); await sleep(500)
    await moveTo('#homeChips button >> nth=4', { ms: 700 })
  })
  await scene('ask', async (at) => {
    await spot(null)
    await click('#input')
    await type('Wann verjähren Schadenersatzansprüche nach österreichischem Recht?')
    await sleep(300); await page.keyboard.press('Enter')
    await moveTo('#messages', { dy: 40, ms: 500 })
    await at(0.5)
    await spot('.msg-ai .steps')
  })
  await scene('answer', async (at) => {
    await page.waitForSelector('.msg-ai .actions', { timeout: 60000 })
    await spot(null)
    await sleep(400)
    await spot('.msg-ai .answer')
    await at(0.25)
    await page.locator('.msg-ai .panel:has(.vrow)').first().scrollIntoViewIfNeeded()
    await spot('.msg-ai .panel:has(.vrow)')
    await moveTo('.msg-ai .panel:has(.vrow) .vrow >> nth=0', { ms: 600 })
    await at(0.7)
    await spot('.msg-ai .actions')
    await moveTo('.msg-ai .actions button:has-text("Word")', { ms: 600 }).catch(() => {})
  })
  await scene('add', async (at) => {
    await spot(null)
    await pill('2', 'Unterlagen hinzufügen')
    await click('#sbNew')
    await sleep(500)
    await click('#addBtn')
    await spot('#addBtn')
    await at(0.28)
    await spot(['#attachBtn', '#msBtn'])
    await moveTo('#attachBtn', { ms: 500 }); await sleep(600); await moveTo('#msBtn', { ms: 400 })
    await at(0.62)
    await spot(['#folderBtn', '#matterBtn'])
    await moveTo('#folderBtn', { ms: 500 }); await sleep(700); await moveTo('#matterBtn', { ms: 400 })
  })
  await scene('folder', async (at) => {
    await spot(null)
    await moveTo('#folderBtn', { ms: 450 })
    await page.mouse.down(); await sleep(80); await page.mouse.up().catch(() => {})
    // the native folder picker cannot be recorded: hand over an origin-private folder instead
    await page.evaluate(async (files) => {
      if (typeof closePop === 'function') closePop()
      const root = await navigator.storage.getDirectory()
      try { await root.removeEntry('Mandantin Huber', { recursive: true }) } catch {}
      const dir = await root.getDirectoryHandle('Mandantin Huber', { create: true })
      for (const f of files) {
        const parts = f.path.split('/'); let d = dir
        for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true })
        const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable()
        await w.write(Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))); await w.close()
      }
      await window.__aissSetFolderHandle(dir)
    }, folderFiles)
    await sleep(500)
    await spot('#attachList')
    await at(0.18)
    await click('#input')
    await type('Welche Kündigungsregeln enthält der Mietvertrag Wien?', 36)
    await sleep(250); await page.keyboard.press('Enter')
    await spot('.msg-ai:last-child .steps')
    await page.waitForSelector('.msg-ai .actions', { timeout: 60000 })
    await sleep(300)
    await spot('.msg-ai .answer')
    await at(0.78)
    await spot('#saveLine')
    await moveTo('#saveLine', { ms: 600 })
  })
  await scene('skills', async (at) => {
    await spot(null)
    await pill('3', 'Skills')
    await click('#input')
    await page.keyboard.type('/')
    await page.waitForSelector('#dlg.show .skill-pick', { timeout: 5000 }).catch(() => {})
    await sleep(400)
    await spot('#dlg.show .modal-card')
    await at(0.5)
    await moveTo('#dlg.show .skill-pick >> text=Mandantenbrief', { ms: 600 })
    await at(0.9)
    await page.keyboard.press('Escape')
    await spot(null)
  })
  await scene('agents', async (at) => {
    await pill('4', 'Fachagenten')
    await click('#navAgentReview')
    await page.waitForSelector('#agentPage .wf')
    await spot('#agentPage .wf')
    await moveTo('#agentPage .wf-step >> nth=1', { ms: 600 }); await sleep(700); await moveTo('#agentPage .wf-step >> nth=4', { ms: 700 })
    await at(0.55)
    await spot(null)
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 30); await sleep(30) }
    await spot('#agentPage .agent-cols')
    await moveTo('#agentAddBtn', { ms: 600 })
  })
  await scene('dd', async (at) => {
    await spot(null)
    await pill('5', 'Due Diligence')
    await click('#navDd')
    await page.waitForSelector('#mattersPage .card.click')
    await spot('#mattersPage .card.click')
    await sleep(500)
    await click('#mattersPage .card.click')
    await page.waitForSelector('#matterPage .tabs')
    await spot(null)
    await at(0.35)
    await click('#matterPage .tabs .tab:has-text("Befunde")')
    await sleep(300)
    await spot('#matterPage .tbl-wrap, #matterPage .findings')
    await at(0.72)
    await click('#matterPage .tabs .tab:has-text("Berichte")')
    await sleep(300)
    await spot('#matterPage .tbl-wrap')
  })
  await scene('matters', async (at) => {
    await spot(null)
    await pill('6', 'Akten & Einstellungen')
    await click('#navMatters')
    await page.waitForSelector('#mattersPage .card.click')
    await spot('#mattersPage .cards')
    await moveTo('#mattersPage .card.click >> nth=0', { ms: 600 })
    await at(0.5)
    await spot(null)
    await click('#navSettings')
    await page.locator('#cardSources').scrollIntoViewIfNeeded()
    await spot('#cardSources')
    await moveTo('#swFolderSave', { ms: 600 }); await sleep(400); await moveTo('#msConnectBtn', { ms: 500 })
  })
  await scene('outro', async () => {
    await spot(null)
    await page.evaluate(() => window.__demo.card(`<div class="logo"><img src="/aissociate-logo.png" alt=""></div><h1>Jetzt ausprobieren</h1><p>Feature-Tour jederzeit unter <b>Einstellungen → Daten &amp; Hilfe</b>.</p>`))
  })
  await sleep(1500)
  await cdp.send('Page.stopScreencast')
  await sleep(300)
  const end = now() - t0
  fs.writeFileSync(path.join(DIR, 'timeline.json'), JSON.stringify({ t0, end, firstFrame: frames[0]?.ts, frames: frames.map((f) => ({ file: path.basename(f.file), ts: f.ts })), scenes: timeline }, null, 1))
  console.log('frames', frames.length, 'duration', end.toFixed(1))
  await browser.close(); srv.kill(); for (const [s] of servers) s.close()
  if (/Error/.test(log)) console.log(log.split('\n').filter((l) => /rror/.test(l)).slice(0, 10).join('\n'))
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
