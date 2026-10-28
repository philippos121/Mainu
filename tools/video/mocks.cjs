// Demo backends for the explainer video: model (Responses API), AI:ssociate (SSE) and RIS (OGD v2.6).
// Answers are fixed, legally accurate texts so the recording is reproducible.
const http = require('http')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)) })

const KB_VERJ = `**Kurzantwort**

Schadenersatzansprüche verjähren nach § 1489 ABGB grundsätzlich in **drei Jahren** ab dem Zeitpunkt, zu dem der Geschädigte den Schaden und die Person des Schädigers kennt.

**Beurteilung**

- **Beginn der Frist:** Maßgeblich ist, dass der Geschädigte Schaden und Schädiger so weit kennt, dass er eine Klage mit Aussicht auf Erfolg erheben kann.
- **Lange Frist:** Ist der Schädiger nicht bekannt geworden oder stammt der Schaden aus einer gerichtlich strafbaren Handlung, die nur vorsätzlich begangen werden kann und mit mehr als einjähriger Freiheitsstrafe bedroht ist, erlischt das Klagerecht erst nach **30 Jahren** (§ 1489 Satz 2 ABGB).
- **Unterbrechung:** Eine Klage unterbricht die Verjährung, wenn das Verfahren gehörig fortgesetzt wird (§ 1497 ABGB).

**Prüfpunkt**

Den Zeitpunkt der Kenntnis festhalten – er ist der Anknüpfungspunkt der dreijährigen Frist (§ 1489 ABGB).`

const KB_DD = `**Kurzantwort**

Change-of-Control-Klauseln sind als Ausdruck der Privatautonomie grundsätzlich zulässig. Beim Share Deal bleibt die Gesellschaft Vertragspartnerin; ein Kündigungsrecht besteht daher nur, wenn es – wie hier – vereinbart ist.

**Haftungsbegrenzung**

Haftungsbeschränkungen sind zwischen Unternehmern grundsätzlich wirksam, erfassen aber Vorsatz und krass grobe Fahrlässigkeit nicht (§ 879 ABGB).`

const DOCS = {
  liefer: { re: /liefervertrag/i, type: 'Rahmenliefervertrag', area: 'vertraege', title: 'Rahmenliefervertrag mit der Großkundin Alpenstahl AG', difficulty: 'hard',
    summary: 'Rahmenliefervertrag über Präzisionsteile; rund 38 % des Umsatzes der Zielgesellschaft. Enthält ein Kündigungsrecht bei Kontrollwechsel und eine Haftungsbegrenzung zugunsten der Kundin.',
    parties: ['Alpentech GmbH (Lieferantin)', 'Alpenstahl AG (Kundin)'],
    findings: [
      { severity: 'red', title: 'Kündigungsrecht der Großkundin bei Kontrollwechsel', description: 'Mit dem Erwerb der Anteile kann die Kundin den Vertrag mit sofortiger Wirkung kündigen; der Vertrag trägt rund 38 % des Umsatzes.', quote: 'Bei einem Wechsel der Kontrolle über die Lieferantin ist die Kundin berechtigt, den Vertrag mit sofortiger Wirkung zu kündigen.', location: 'Punkt 12.3', recommendation: 'Verzichtserklärung der Kundin als Closing-Bedingung vereinbaren.', deal_impact: 'CP', rule: 'VERT-001', norms: [] },
      { severity: 'amber', title: 'Haftungsbegrenzung zugunsten der Kundin', description: 'Die Haftung der Kundin ist mit dem jährlichen Auftragswert begrenzt.', quote: 'Die Haftung der Kundin ist mit dem jährlichen Auftragswert begrenzt.', location: 'Punkt 9.2', recommendation: 'Risiko bei der Kaufpreisbemessung berücksichtigen.', deal_impact: 'Garantie', rule: '', norms: ['§ 879 ABGB'] },
    ],
    legal: ['Ist ein Kündigungsrecht bei Kontrollwechsel im Rahmenliefervertrag wirksam?', 'Ist die Haftungsbegrenzung auf den jährlichen Auftragswert zwischen Unternehmern zulässig?'] },
  miet: { re: /mietvertrag/i, type: 'Mietvertrag (Geschäftsraum)', area: 'immobilien', title: 'Mietvertrag Betriebsliegenschaft Linz', difficulty: 'easy',
    summary: 'Geschäftsraummiete der Produktionshalle in Linz, befristet bis 31.12.2027, ohne Verlängerungsoption.',
    parties: ['Linzer Gewerbepark GmbH (Vermieterin)', 'Alpentech GmbH (Mieterin)'],
    findings: [
      { severity: 'amber', title: 'Befristung bis 2027 ohne Verlängerungsoption', description: 'Der Standort der Produktion ist nur bis Ende 2027 gesichert.', quote: 'Das Mietverhältnis ist bis 31.12.2027 befristet. Eine Verlängerungsoption ist nicht vereinbart.', location: 'Punkt 3', recommendation: 'Verlängerung vor Signing verhandeln oder Kaufpreisabschlag.', deal_impact: 'Nachfrage', rule: '', norms: ['§ 29 MRG'] },
      { severity: 'green', title: 'Untervermietung nur mit Zustimmung', description: 'Für die Transaktion ohne Bedeutung, da kein Mieterwechsel stattfindet.', quote: 'Untervermietung und Weitergabe bedürfen der Zustimmung der Vermieterin.', location: 'Punkt 8', recommendation: '–', deal_impact: 'keine', rule: '', norms: [] },
    ],
    legal: ['Welche Form muss eine Befristung eines Geschäftsraummietvertrags haben?'] },
  gf: { re: /geschäftsführer/i, type: 'Geschäftsführervertrag', area: 'arbeit', title: 'Geschäftsführervertrag DI Anna Berger', difficulty: 'hard',
    summary: 'Anstellungsvertrag der Geschäftsführerin mit Sonderabfertigung bei Kontrollwechsel.',
    parties: ['Alpentech GmbH', 'DI Anna Berger'],
    findings: [
      { severity: 'red', title: 'Sonderabfertigung von 24 Monatsentgelten bei Kontrollwechsel', description: 'Der Erwerb löst eine Zahlung von rund 480.000 EUR aus.', quote: 'Im Fall eines Kontrollwechsels steht der Geschäftsführerin eine Abfertigung in Höhe von 24 Monatsentgelten zu.', location: 'Punkt 6', recommendation: 'Als Schuldposition im Kaufpreis berücksichtigen.', deal_impact: 'Kaufpreis', rule: '', norms: [] },
    ],
    legal: ['Ist eine Sonderabfertigung bei Kontrollwechsel im Geschäftsführervertrag wirksam?'] },
}
const docOf = (name) => Object.values(DOCS).find((d) => d.re.test(name)) || DOCS.liefer

function modelServer() {
  const chain = new Map()
  return http.createServer(async (req, res) => {
    const j = JSON.parse((await body(req)) || '{}')
    const instr = String(j.instructions || '')
    const inputText = JSON.stringify(j.input || '')
    const usage = { input_tokens: 2400, output_tokens: 420, input_tokens_details: { cached_tokens: 600 } }
    const msg = (text, annotations = []) => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations }] })
    const fmt = j.text?.format?.name || ''
    let output
    const docName = (inputText.match(/DOKUMENT: ([^\\"]+?)(?: \(| \\n|\\n)/) || [])[1] || ''
    if (fmt === 'dd_triage') {
      const d = docOf(docName); output = [msg(JSON.stringify({ doc_type: d.type, area: d.area, difficulty: d.difficulty }))]
    } else if (fmt === 'dd_document') {
      const d = docOf(docName)
      output = [msg(JSON.stringify({ doc_type: d.type, area: d.area, title: d.title, summary: d.summary, parties: d.parties, dates: [{ label: 'Abschluss', date: '2021-03-01' }], key_terms: [{ term: 'Laufzeit', value: d === DOCS.miet ? 'bis 31.12.2027' : 'unbefristet' }], findings: d.findings.map((f) => ({ ...f, area: d.area })), missing_or_unclear: d === DOCS.liefer ? ['Anlage 2 (Preisliste) fehlt'] : [], questions: d === DOCS.liefer ? ['Liegt eine Verzichtserklärung der Kundin zum Kontrollwechsel vor?'] : [], legal_questions: d.legal, legal_difficulty: d.difficulty }))]
    } else if (fmt === 'dd_area') {
      output = [msg(JSON.stringify({ summary: 'Zwei Verträge knüpfen Rechtsfolgen an den Kontrollwechsel; beide sind für den Kaufpreis und die Closing-Bedingungen relevant.', key_risks: ['Kündigungsrecht der Großkundin', 'Sonderabfertigung der Geschäftsführerin'], cross_document_issues: ['Kontrollwechsel-Klauseln in zwei Verträgen'], missing_documents: ['Top-10-Kundenliste'], requests: ['Verzichtserklärung der Alpenstahl AG vorlegen'], deal_recommendations: ['Verzicht der Kundin als Closing-Bedingung'] }))]
    } else if (fmt === 'dd_exec') {
      output = [msg(JSON.stringify({ executive_summary: 'Die Prüfung zeigt zwei wesentliche Risiken aus dem Kontrollwechsel: das Kündigungsrecht der Großkundin und die Sonderabfertigung der Geschäftsführerin.\n\nEmpfohlen werden ein Verzicht der Kundin als Closing-Bedingung und die Berücksichtigung der Abfertigung im Kaufpreis.', top_red_flags: ['Kündigungsrecht der Großkundin bei Kontrollwechsel', 'Sonderabfertigung von 24 Monatsentgelten'], overall_assessment: 'wesentliche Risiken', next_steps: ['Verzichtserklärung der Kundin einholen', 'Kaufpreismechanismus anpassen', 'Mietvertragsverlängerung verhandeln'] }))]
    } else if (fmt === 'kb_questions') {
      output = [msg(JSON.stringify({ questions: DOCS.liefer.legal }))]
    } else if (fmt === 'review_row') {
      const cols = j.text.format.schema.properties.cells.items.properties.column.enum
      output = [msg(JSON.stringify({ cells: cols.map((c) => ({ column: c, value: '–', quote: '', location: '' })) }))]
    } else if (fmt === 'kb_context') {
      output = [msg(JSON.stringify({ facts: '', excerpts: [] }))]
    } else if (/entscheide als JSON/.test(instr)) {
      const ask = inputText.split('ANFRAGE:').pop()
      const folder = /Kündigung/.test(ask)
      output = [msg(JSON.stringify(folder
        ? { mode: 'document', legal_area: 'civil', scope: '', questions: [], difficulty: 'easy', needs_document_context: false, skill: '', title: 'Kündigungsregeln Mietvertrag Wien' }
        : { mode: 'legal', legal_area: 'civil', scope: '', questions: ['Wann verjähren Schadenersatzansprüche nach österreichischem Recht?'], difficulty: 'hard', needs_document_context: false, skill: '', title: 'Verjährung von Schadenersatzansprüchen' }))]
    } else if (/einfache Rechtsfrage direkt/.test(instr)) {
      output = [{ type: 'web_search_call', id: 'ws_e', status: 'completed', action: { type: 'search', query: 'Befristung Geschäftsraummiete § 29 MRG' } }, msg('**Kurzantwort**\n\nEine Befristung ist nach § 29 MRG nur durchsetzbar, wenn sie schriftlich vereinbart wurde; für Geschäftsräumlichkeiten gilt keine Mindestdauer.', [{ type: 'url_citation', url: 'https://www.ris.bka.gv.at/eli/bgbl/1981/520/P29', title: 'RIS – § 29 MRG', start_index: 0, end_index: 5 }])]
    } else if (/Dokumentaufgabe/.test(instr)) {
      const st = j.previous_response_id ? (chain.get(j.previous_response_id) ?? 0) : 0
      const outText = (j.input || []).filter((x) => x.type === 'function_call_output').map((x) => x.output).join('\n')
      await sleep(900)
      if (st === 0) output = [{ type: 'function_call', id: 'fc_s', call_id: 'call_s' + Date.now(), name: 'files_search', arguments: JSON.stringify({ query: 'Kündigung' }) }]
      else if (st === 1) { const p = (outText.match(/\n1\. (.+?) \(/) || [])[1] || 'Mietsache/Mietvertrag Wien.docx'; output = [{ type: 'function_call', id: 'fc_r', call_id: 'call_r' + Date.now(), name: 'files_read', arguments: JSON.stringify({ path: p }) }] }
      else output = [msg('**Kündigungsregeln im Mietvertrag Wien**\n\nGefunden in *Mietsache/Mietvertrag Wien.docx*, Punkt 7:\n\n- Die Mieterin kann unter Einhaltung einer **dreimonatigen Frist** zum Ende jedes Kalendervierteljahres kündigen.\n- Die Vermieterin verzichtet für die ersten **fünf Jahre** auf ihr Kündigungsrecht; danach kann sie nur aus wichtigen Gründen im Sinne des § 30 MRG kündigen.\n- Jede Kündigung bedarf der **Schriftform**.\n\nDie übrigen Dateien im Ordner enthalten keine abweichenden Regelungen.')]
      const id = 'resp_' + Math.random().toString(36).slice(2)
      chain.set(id, st + 1)
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ id, object: 'response', status: 'completed', model: j.model, output, usage }))
    } else {
      output = [msg('Erledigt.')]
    }
    await sleep(fmt ? 150 : 700)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ id: 'resp_' + Math.random().toString(36).slice(2), object: 'response', status: 'completed', model: j.model, output, usage }))
  })
}

function kbServer({ fast = false } = {}) {
  return http.createServer(async (req, res) => {
    const j = JSON.parse((await body(req)) || '{}')
    const dd = /Kontrollwechsel|Haftungsbegrenzung|Sonderabfertigung|Befristung/.test(j.question || '')
    const text = dd ? KB_DD : KB_VERJ
    res.setHeader('Content-Type', 'text/event-stream')
    const w = (s) => new Promise((r) => res.write(s, r))
    await w(`id: 1\nevent: message\ndata: ${JSON.stringify({ meta: { qa_metadata: { thread_id: j.thread_id || 'thr_demo' } }, text: '', type: 'qa_metadata' })}\n\n`)
    if (!dd && !fast) await sleep(2600) // the knowledge base "thinks" before streaming
    let i = 2
    for (const c of text.match(/[\s\S]{1,14}/g)) { await w(`id: ${i++}\nevent: message\ndata: ${JSON.stringify({ meta: null, text: c, type: 'message' })}\n\n`); if (!dd && !fast) await sleep(42) }
    const docs = dd
      ? [['§ 879 ABGB', 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P879', 'NOR12018084']]
      : [['§ 1489 ABGB', 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P1489', 'NOR12018920'], ['§ 1497 ABGB', 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P1497', 'NOR12018928']]
    for (const [title, url, id] of docs) await w(`id: ${i++}\nevent: message\ndata: ${JSON.stringify({ meta: { url, title }, text: id, type: 'document_number' })}\n\n`)
    await w(`id: ${i++}\nevent: message\ndata: ${JSON.stringify({ meta: { score: 0.92 }, text: '', type: 'evaluation_metadata' })}\n\n`)
    res.end()
  })
}

const LAWS = { ABGB: ['Allgemeines bürgerliches Gesetzbuch', 'jgs/1811/946'], MRG: ['Mietrechtsgesetz', 'bgbl/1981/520'], KSchG: ['Konsumentenschutzgesetz', 'bgbl/1979/140'], UGB: ['Unternehmensgesetzbuch', 'dRGBl/1897/219'], GmbHG: ['GmbH-Gesetz', 'rgbl/1906/58'] }
function risServer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    await sleep(350)
    res.setHeader('Content-Type', 'application/json')
    if (/Bundesrecht/.test(u.pathname)) {
      const law = (u.searchParams.get('Titel') || u.searchParams.get('Suchworte') || '').trim()
      const num = u.searchParams.get('Abschnitt.Von')
      const L = LAWS[law]
      if (!L || !num) return res.end(JSON.stringify({ OgdSearchResult: { OgdDocumentResults: { Hits: { '#text': '0' } } } }))
      const id = 'NOR' + (40000000 + Number(String(num).replace(/\D/g, '')) * 7)
      const url = `https://www.ris.bka.gv.at/eli/${L[1]}/P${num}`
      return res.end(JSON.stringify({ OgdSearchResult: { OgdDocumentResults: { Hits: { '#text': '1' }, OgdDocumentReference: { Data: { Metadaten: { Technisch: { ID: id, Applikation: 'BrKons' }, Allgemein: { DokumentUrl: url }, Bundesrecht: { Kurztitel: L[0], BrKons: { Abkuerzung: law, ArtikelParagraphAnlage: `§ ${num}` } } } } } } } }))
    }
    res.end(JSON.stringify({ OgdSearchResult: { OgdDocumentResults: { Hits: { '#text': '0' } } } }))
  })
}

module.exports = { modelServer, kbServer, risServer }
