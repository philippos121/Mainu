// Assembles frames + narration into erklaervideo.mp4 (captions burned in below the picture), plus poster, WebVTT and chapter marks.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const DIR = __dirname
const OUT = path.join(DIR, 'out'); fs.mkdirSync(OUT, { recursive: true })
const T = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'))
const LEAD = 0.35 // narration starts shortly after the scene
const base = T.firstFrame
const offset = T.t0 - base
const scenes = T.scenes.map((s) => ({ ...s, at: Math.max(0, s.start + offset + LEAD) }))

// video: frames with their real display time
const lines = []
T.frames.forEach((f, i) => {
  const next = T.frames[i + 1]?.ts ?? f.ts + 1
  lines.push(`file '${path.join(DIR, 'frames', f.file)}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`)
})
lines.push(`file '${path.join(DIR, 'frames', T.frames.at(-1).file)}'`)
fs.writeFileSync(path.join(DIR, 'frames.txt'), lines.join('\n'))
const total = T.frames.at(-1).ts - base + 1

// captions: burned in, centred in a 120 px band below the picture (the UI stays fully visible,
// and every player shows them the same way). Sentences are timed by their share of the narration.
const BAND = 120, W = 1920, H = 1080 + BAND
const fmt = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}` }
const MAX_LINE = 82
const splitLong = (sen) => {
  if (sen.length <= MAX_LINE * 2) return [sen]
  const mid = sen.length / 2
  const cuts = [...sen.matchAll(/(, | – | – |: )/g)].map((m) => m.index + m[0].length)
  const cut = cuts.length ? cuts.reduce((a, c) => (Math.abs(c - mid) < Math.abs(a - mid) ? c : a)) : sen.lastIndexOf(' ', mid)
  return [...splitLong(sen.slice(0, cut).trim()), ...splitLong(sen.slice(cut).trim())]
}
const cues = []
for (const s of scenes) {
  const parts = []
  for (const sen of s.text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g).map((x) => x.trim()).filter(Boolean).flatMap(splitLong)) {
    if (parts.length && (parts.at(-1) + ' ' + sen).length <= 110) parts[parts.length - 1] += ' ' + sen; else parts.push(sen)
  }
  const chars = parts.reduce((a, p) => a + p.length, 0)
  let t = s.at
  for (const p of parts) { const d = s.dur * (p.length / chars); cues.push({ from: t, to: t + d - 0.05, text: p }); t += d }
}
/** Balanced line break for long cues (two lines at most). */
const wrap = (txt) => {
  if (txt.length <= MAX_LINE) return [txt]
  const words = txt.split(' '); let best = null
  for (let i = 1; i < words.length; i++) { const a = words.slice(0, i).join(' '), b = words.slice(i).join(' '); const score = Math.max(a.length, b.length); if (!best || score < best.score) best = { score, lines: [a, b] } }
  return best.lines
}
fs.writeFileSync(path.join(OUT, 'erklaervideo.vtt'), 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${fmt(c.from)} --> ${fmt(c.to)} line:90% position:50% align:center\n${wrap(c.text).join('\n')}\n`).join('\n'))
const assTime = (t) => { const cs = Math.round(t * 100); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}` }
const assEsc = (t) => t.replace(/\\/g, '＼').replace(/[{}]/g, '')
fs.writeFileSync(path.join(DIR, 'subs.ass'), `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map((c) => `Dialogue: 0,${assTime(c.from)},${assTime(c.to)},Cap,,0,0,0,,{\\an5\\pos(${W / 2},${1080 + BAND / 2})}${wrap(c.text).map(assEsc).join('\\N')}`).join('\n')}
`)

// chapters (first scene of each chapter)
const chapters = []
for (const s of scenes) if (!chapters.length || chapters.at(-1)[0] !== s.chapter) chapters.push([s.chapter, Math.max(0, Math.floor(s.at - LEAD))])
fs.writeFileSync(path.join(OUT, 'chapters.json'), JSON.stringify(chapters))

// audio: each clip at its scene time
const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(DIR, 'frames.txt')]
scenes.forEach((s) => args.push('-i', path.join(DIR, 'audio', s.id + '.wav')))
const filt = scenes.map((s, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(s.at * 1000)}:all=1[a${i}]`).join(';') +
  `;${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0,highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:${total.toFixed(2)}[aout]` +
  `;[0:v]fps=30,scale=1920:1080:flags=lanczos,pad=${W}:${H}:0:0:color=0x0b2a31,drawbox=x=0:y=1080:w=${W}:h=3:color=0xF39200:t=fill,ass=${path.join(DIR, 'subs.ass')},format=yuv420p[vout]`
args.push('-filter_complex', filt, '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'stillimage', '-g', '60',
  '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
  '-metadata', 'title=AI:ssociate Playground – Die Funktionen im Überblick', '-movflags', '+faststart', '-t', total.toFixed(2), path.join(OUT, 'erklaervideo.mp4'))
execFileSync('ffmpeg', args, { stdio: 'inherit' })
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.5', '-i', path.join(OUT, 'erklaervideo.mp4'), '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '4', path.join(OUT, 'erklaervideo.jpg')])
console.log('total', total.toFixed(1), 's · chapters', JSON.stringify(chapters))
console.log(fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB`).join('\n'))
