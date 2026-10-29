# Narration with Coqui TTS (Thorsten VITS, 22 kHz, gruut phonemes):
#   python tts_coqui.py <model_dir>            → audio/*.wav, audio/durations.json
#   python tts_coqui.py <model_dir> --phonemes → print the phonemes of every scene (to review)
# PRON fixes words the gruut grapheme-to-phoneme guesser gets wrong (checked against its output).
import json, re, sys, wave
from TTS.api import TTS
PRON = {
    'Dateien': 'Datei-en', 'Startseite': 'Start-Saite', 'jederzeit': 'jeder Zeit', 'wenigen': 'wehnigen',
    'durchsucht': 'durch-sucht', 'überschreiben': 'über-schreiben', 'größere': 'grösere', 'Quelle': 'Kwelle',
    'Rechtsrecherche': 'Rechts-Recherche', 'einer': 'ainer', 'analysiert': 'analüsiert', 'Datenräume': 'Daten-Räume',
    'hochgeladen': 'hoch-geladen', 'Eingabefeld': 'Eingabe-Feld', 'Rechtsgebiet': 'Rechts-Gebit',
    'Rechtsinformationssystem': 'Rechts-Informations-System', 'Fundstelle': 'Fund-Stelle', 'Fundstellen': 'Fund-Stellen',
    'Unterlagen': 'Unter-Lagen', 'Unterhaltungen': 'Unter-Haltungen', 'Unterhaltung': 'Unter-Haltung', 'Bearbeiten': 'be-arbeiten', 'Fachagenten': 'Fach-Agenten', 'österreichisches': 'öster-reichisches', 'österreichischem': 'öster-reichischem',
}
def fix(t):
    for a, b in PRON.items(): t = re.sub(r'(?<![\w-])' + re.escape(a) + r'(?![\w-])', b, t)
    return t
m = sys.argv[1].rstrip('/')
tts = TTS(model_path=f'{m}/model_file.pth', config_path=f'{m}/config.json', progress_bar=False)
n = json.load(open('narration.json'))
if '--phonemes' in sys.argv:
    ph = tts.synthesizer.tts_model.tokenizer.phonemizer
    for s in n: print(s['id'], '|', ph.phonemize(fix(s['tts']), separator=''), '\n')
    sys.exit()
out = {}
for s in n:
    p = f"audio/{s['id']}.wav"
    tts.tts_to_file(text=fix(s['tts']), file_path=p)
    with wave.open(p) as w: out[s['id']] = w.getnframes() / w.getframerate()
json.dump(out, open('audio/durations.json', 'w'))
print(json.dumps({k: round(x, 2) for k, x in out.items()}), 'total', round(sum(out.values()), 1))
