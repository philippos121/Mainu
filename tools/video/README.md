# Erklärvideo (public/media/erklaervideo.*)

Reproducible pipeline for the explainer video shown under Einstellungen → Daten & Hilfe,
in the tour and in the welcome banner. Run it again after visible UI changes.

1. **Narration** – `narration.json` holds per scene the caption text (`text`) and a
   phonetic variant for the speech engine (`tts`, e.g. "Essouschi-ejt" for AI:ssociate,
   "Schärpoint", "Ecksel"). Voice: Coqui TTS with the German Thorsten VITS model (22 kHz,
   from the coqui-ai/TTS GitHub release `v0.7.0_models`). `tts_coqui.py` also fixes words
   the gruut grapheme-to-phoneme guesser gets wrong (`PRON`); check new texts with
   `--phonemes` before rendering.

       python3 -m venv venv && venv/bin/pip install coqui-tts torch torchaudio torchcodec "gruut[de]"
       curl -L -o vits.zip https://github.com/coqui-ai/TTS/releases/download/v0.7.0_models/tts_models--de--thorsten--vits.zip && unzip vits.zip
       mkdir -p audio && venv/bin/python tts_coqui.py tts_models--de--thorsten--vits --phonemes   # review
       venv/bin/python tts_coqui.py tts_models--de--thorsten--vits                                # → audio/*.wav, audio/durations.json

   `tts.py` (Piper, `voice-de-thorsten-low`) is the older, lighter fallback. For an Austrian
   studio-quality voice use a cloud service (e.g. Azure AI Speech `de-AT-JonasNeural` /
   `de-AT-IngridNeural`) and write the clips to `audio/` with the same file names.

2. **Recording** – `LOCAL_SANDBOX_PYTHON=python3 node record.cjs` starts `server.js` against the
   demo backends in `mocks.cjs`: model (incl. a "code model" that writes real python-docx /
   openpyxl programs), AI:ssociate and RIS with fixed, legally checked texts, Microsoft
   Entra login and Graph with a SharePoint library. Generated code runs in the local stand-in
   sandbox (`SANDBOX=local`, needs python-docx and openpyxl), so the Word comments, Excel
   files and letters in the video are real. It seeds accounts, a due diligence, two Akten
   and a shared project, drives the real UI with Playwright (visible cursor, highlights,
   chapter labels) and captures 1080p frames via the Chrome screencast. Each scene lasts at
   least as long as its narration clip.

3. **Assembly** – `node build.cjs` (needs ffmpeg with libass and the Inter font) writes
   `out/erklaervideo.mp4` (1920×1200: the 1080p picture plus a 120 px band in which the
   captions are burned in, centred), `out/erklaervideo.jpg` (poster),
   `out/erklaervideo.vtt` and `out/chapters.json`.

4. Copy `out/erklaervideo.{mp4,jpg}` to `public/media/` and update `VIDEO_CHAPTERS` in
   `public/index.html` from `out/chapters.json`. The app shows the video buttons only when
   `/media/erklaervideo.mp4` exists.
