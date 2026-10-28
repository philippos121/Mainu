# Erklärvideo (public/media/erklaervideo.*)

Reproducible pipeline for the explainer video shown under Einstellungen → Daten & Hilfe,
in the tour and in the welcome banner. Run it again after visible UI changes.

1. **Narration** – `narration.json` holds per scene the caption text (`text`) and a
   phonetic variant for the speech engine (`tts`, e.g. "Essouschi-eit" for AI:ssociate).
   Offline German voice: [Piper](https://github.com/rhasspy/piper) with
   `voice-de-thorsten-low` (GitHub release v0.0.2):

       pip install piper-tts
       curl -L -o voice.tgz https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-de-thorsten-low.tar.gz && tar -xzf voice.tgz
       mkdir -p audio && python3 tts.py de-thorsten-low.onnx      # → audio/*.wav, audio/durations.json

2. **Recording** – `node record.cjs` starts `server.js` against the demo backends in
   `mocks.cjs` (model, AI:ssociate and RIS with fixed, legally checked texts), seeds a due
   diligence and two Akten, drives the real UI with Playwright (visible cursor, highlights,
   chapter labels) and captures 1080p frames via the Chrome screencast. Each scene lasts
   at least as long as its narration clip. Needs Playwright with Chromium.

3. **Assembly** – `node build.cjs` (needs ffmpeg) writes `out/erklaervideo.mp4` (H.264,
   AAC, embedded German subtitles), `out/erklaervideo.jpg` (poster), `out/erklaervideo.vtt`
   and `out/chapters.json`.

4. Copy `out/erklaervideo.{mp4,jpg,vtt}` to `public/media/` and update `VIDEO_CHAPTERS` in
   `public/index.html` from `out/chapters.json`. The app shows the video buttons only when
   `/media/erklaervideo.mp4` exists.
