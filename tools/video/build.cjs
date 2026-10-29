// Assembles the recorded frames into erklaervideo.mp4 (1920×1080, no sound: each scene opens with
// a text slide), plus poster and chapter marks.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const DIR = __dirname
const OUT = path.join(DIR, 'out'); fs.mkdirSync(OUT, { recursive: true })
const T = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'))
const base = T.firstFrame
const offset = T.t0 - base

// frames with their real display time
const lines = []
T.frames.forEach((f, i) => {
  const next = T.frames[i + 1]?.ts ?? f.ts + 1
  lines.push(`file '${path.join(DIR, 'frames', f.file)}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`)
})
lines.push(`file '${path.join(DIR, 'frames', T.frames.at(-1).file)}'`)
fs.writeFileSync(path.join(DIR, 'frames.txt'), lines.join('\n'))
const total = T.frames.at(-1).ts - base + 1

// chapters: the slide of the first scene of each chapter
const chapters = []
for (const s of T.scenes) if (!chapters.length || chapters.at(-1)[0] !== s.chapter) chapters.push([s.chapter, Math.max(0, Math.floor(s.start + offset))])
fs.writeFileSync(path.join(OUT, 'chapters.json'), JSON.stringify(chapters))

execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(DIR, 'frames.txt'),
  '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-an',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'stillimage', '-g', '60',
  '-metadata', 'title=AI:ssociate Playground – Die Funktionen im Überblick', '-movflags', '+faststart', '-t', total.toFixed(2), path.join(OUT, 'erklaervideo.mp4')], { stdio: 'inherit' })
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', path.join(OUT, 'erklaervideo.mp4'), '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '4', path.join(OUT, 'erklaervideo.jpg')])
for (const f of ['erklaervideo.vtt']) fs.rmSync(path.join(OUT, f), { force: true })
console.log('total', total.toFixed(1), 's · chapters', JSON.stringify(chapters))
console.log(fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB`).join('\n'))
