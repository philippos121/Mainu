// Assembles frames + narration into erklaervideo.mp4, plus poster, WebVTT captions and chapter marks.
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

// captions: sentences of each scene, timed by their share of the narration
const fmt = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}` }
const cues = []
for (const s of scenes) {
  const parts = []
  for (const sen of s.text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g).map((x) => x.trim()).filter(Boolean)) {
    if (parts.length && (parts.at(-1) + ' ' + sen).length <= 90) parts[parts.length - 1] += ' ' + sen; else parts.push(sen)
  }
  const chars = parts.reduce((a, p) => a + p.length, 0)
  let t = s.at
  for (const p of parts) { const d = s.dur * (p.length / chars); cues.push({ from: t, to: t + d - 0.05, text: p }); t += d }
}
const wrap = (txt) => { if (txt.length <= 48) return txt; const words = txt.split(' '); let a = ''; while (words.length && (a + ' ' + words[0]).trim().length <= Math.ceil(txt.length / 2) + 6) a = (a + ' ' + words.shift()).trim(); return a + '\n' + words.join(' ') }
fs.writeFileSync(path.join(OUT, 'erklaervideo.vtt'), 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${fmt(c.from)} --> ${fmt(c.to)}\n${wrap(c.text)}\n`).join('\n'))
fs.writeFileSync(path.join(DIR, 'subs.srt'), cues.map((c, i) => `${i + 1}\n${fmt(c.from).replace('.', ',')} --> ${fmt(c.to).replace('.', ',')}\n${wrap(c.text)}\n`).join('\n'))

// chapters (first scene of each chapter)
const chapters = []
for (const s of scenes) if (!chapters.length || chapters.at(-1)[0] !== s.chapter) chapters.push([s.chapter, Math.max(0, Math.floor(s.at - LEAD))])
fs.writeFileSync(path.join(OUT, 'chapters.json'), JSON.stringify(chapters))

// audio: each clip at its scene time
const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(DIR, 'frames.txt')]
scenes.forEach((s) => args.push('-i', path.join(DIR, 'audio', s.id + '.wav')))
args.push('-i', path.join(DIR, 'subs.srt'))
const filt = scenes.map((s, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(s.at * 1000)}:all=1[a${i}]`).join(';') +
  `;${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0,highpass=f=70,acompressor=threshold=0.25:ratio=2.5:attack=10:release=200,volume=1.5,alimiter=limit=0.89:level=false,apad,atrim=0:${total.toFixed(2)}[aout]` +
  `;[0:v]fps=30,scale=1920:1080:flags=lanczos,format=yuv420p[vout]`
args.push('-filter_complex', filt, '-map', '[vout]', '-map', '[aout]', '-map', `${scenes.length + 1}:s`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'stillimage', '-g', '60',
  '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=deu',
  '-metadata', 'title=AI:ssociate Playground – Die Funktionen im Überblick', '-movflags', '+faststart', '-t', total.toFixed(2), path.join(OUT, 'erklaervideo.mp4'))
execFileSync('ffmpeg', args, { stdio: 'inherit' })
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.5', '-i', path.join(OUT, 'erklaervideo.mp4'), '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '4', path.join(OUT, 'erklaervideo.jpg')])
console.log('total', total.toFixed(1), 's · chapters', JSON.stringify(chapters))
console.log(fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB`).join('\n'))
