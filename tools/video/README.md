# Erklärvideo (public/media/erklaervideo.*)

Reproducible pipeline for the explainer video shown under Einstellungen → Daten & Hilfe,
in the tour and in the welcome banner. Run it again after visible UI changes.

The video has no sound: each scene opens with a white slide (chapter, title, one or two
short sentences), then shows the real UI.

1. **Scenes** – `scenes.json` holds per scene the chapter, the slide's `title` and `text`,
   and `dur`, the planned length of the screen part in seconds (actions are spread over it;
   a scene that waits for a result runs longer). `slide: false` skips the slide (the scene
   continues the previous one). A slide stays up for about 1 s plus 0.22 s per word.

2. **Recording** – `LOCAL_SANDBOX_PYTHON=python3 node record.cjs` starts `server.js` against the
   demo backends in `mocks.cjs`: model (incl. a "code model" that writes real python-docx /
   openpyxl programs), AI:ssociate and RIS with fixed, legally checked texts, Microsoft
   Entra login and Graph with a SharePoint library. Generated code runs in the local stand-in
   sandbox (`SANDBOX=local`, needs python-docx and openpyxl), so the Word comments, Excel
   files and letters in the video are real. It seeds accounts, a due diligence, two Akten
   and a shared project, drives the real UI with Playwright (visible cursor, highlights,
   text slides) and captures 1080p frames via the Chrome screencast. Headless Chromium has
   no microphone, so a scripted speech engine replaces `SpeechRecognition` for the dictation
   scene.

3. **Assembly** – `node build.cjs` (needs ffmpeg) writes `out/erklaervideo.mp4` (1920×1080,
   no audio track), `out/erklaervideo.jpg` (poster: the title slide) and `out/chapters.json`.

4. Copy `out/erklaervideo.{mp4,jpg}` to `public/media/` and update `VIDEO_CHAPTERS` in
   `public/index.html` from `out/chapters.json`. The app shows the video buttons only when
   `/media/erklaervideo.mp4` exists.
