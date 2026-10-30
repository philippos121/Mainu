// Measures a finished due diligence against an expected result (regression after every change).
//
//   node eval/run.mjs --data <DATA_DIR> --matter <matter id> --expected <file.json>
//
// The expected file lists the themes a careful reviewer reports for that Akt, and the known
// traps (constellations that must NOT become a theme). Format: see eval/expected.example.json.
// Matching: a theme counts as found when its title/key/description matches the "match" pattern
// (a regular expression, case-insensitive). The Akt itself is not part of the repository.
import fs from 'node:fs'
import path from 'node:path'
import mammoth from 'mammoth'
import { ruleStats } from '../lib/issues.js'

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null }
const dataDir = arg('data') || process.env.DATA_DIR || './data'
const matterId = arg('matter'), expectedFile = arg('expected')
if (!matterId || !expectedFile) { console.error('usage: node eval/run.mjs --data <DATA_DIR> --matter <id> --expected <file.json>'); process.exit(2) }

const main = JSON.parse(fs.readFileSync(path.join(dataDir, 'matters', `${matterId}.json`), 'utf8'))
for (const part of main.__parts || []) { try { main[part] = JSON.parse(fs.readFileSync(path.join(dataDir, 'matters', matterId, `${part}.json`), 'utf8')) } catch { main[part] = [] } }
const m = main
const exp = JSON.parse(fs.readFileSync(expectedFile, 'utf8'))
const grade = (t) => t.review?.grade || t.gradeCalibrated || t.gradeComputed
const live = (m.themes || []).filter((t) => !t.discarded && !t.mergedInto && t.review?.status !== 'rejected')
const reported = live.filter((t) => ['red', 'amber'].includes(grade(t)))
const text = (t) => `${t.title} ${t.key} ${t.description}`
const hit = (e) => reported.filter((t) => new RegExp(e.match, 'i').test(text(t)))

const expected = exp.themes || [], high = expected.filter((e) => e.grade === 'red')
const found = expected.filter((e) => hit(e).length)
const foundHigh = high.filter((e) => hit(e).some((t) => grade(t) === 'red'))
const reds = reported.filter((t) => grade(t) === 'red')
const redRight = reds.filter((t) => high.some((e) => new RegExp(e.match, 'i').test(text(t))))
const dupes = expected.filter((e) => hit(e).length > 1).map((e) => `${e.match} (${hit(e).map((t) => t.no).join(', ')})`)
const traps = (exp.traps || []).filter((e) => hit(e).length).map((e) => `${e.match} → ${hit(e).map((t) => t.no).join(', ')}`)
const withOriginal = reported.filter((t) => t.manual || (t.evidence || []).length > 0)
let words = null
const rep = (m.reports || []).find((r) => r.kind === 'docx')
if (rep) { try { words = (await mammoth.extractRawText({ path: path.join(dataDir, 'reports', matterId, rep.name) })).value.split(/\s+/).filter(Boolean).length } catch {} }

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 100)
const targets = exp.targets || { highRecall: 100, recall: 80, redPrecision: 80, duplicates: 0, traps: 0, evidence: 100, maxWords: 15000 }
const rows = [
  ['Trefferquote hoch', `${pct(foundHigh.length, high.length)} %`, pct(foundHigh.length, high.length) >= targets.highRecall],
  ['Trefferquote gesamt', `${pct(found.length, expected.length)} %`, pct(found.length, expected.length) >= targets.recall],
  ['Genauigkeit rot', `${pct(redRight.length, reds.length)} % (${redRight.length}/${reds.length})`, pct(redRight.length, reds.length) >= targets.redPrecision],
  ['doppelte Themen', String(dupes.length), dupes.length <= targets.duplicates],
  ['Fallen', String(traps.length), traps.length <= targets.traps],
  ['Belegquote', `${pct(withOriginal.length, reported.length)} %`, pct(withOriginal.length, reported.length) >= targets.evidence],
  ['Wörter im Bericht', words == null ? 'n/a' : String(words), words == null || words <= targets.maxWords],
]
for (const [k, v, ok] of rows) console.log(`${ok ? 'ok  ' : 'FAIL'} ${k.padEnd(20)} ${v}`)
// Per rule: how many of its issues held up (a high share of refuted/excluded/rejected issues marks a rule that fires too often).
console.log('\nje Regel (Themen · gehalten · nicht gehalten):')
for (const r of ruleStats(m)) console.log(`${r.falseRate >= 50 && r.issues >= 3 ? 'prüfen' : '      '} ${r.source.padEnd(14)} ${String(r.issues).padStart(3)} · ${String(r.issues - r.refuted - r.excluded - r.notApplicable - r.rejected).padStart(3)} · ${r.falseRate} %  ${r.label}`)
const missed = expected.filter((e) => !hit(e).length)
if (missed.length) console.log('\nnicht gefunden:\n' + missed.map((e) => `- [${e.grade}] ${e.label || e.match}`).join('\n'))
if (dupes.length) console.log('\ndoppelt:\n' + dupes.map((x) => '- ' + x).join('\n'))
if (traps.length) console.log('\nFallen gemeldet:\n' + traps.map((x) => '- ' + x).join('\n'))
process.exit(rows.every((r) => r[2]) ? 0 : 1)
