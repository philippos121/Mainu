import json, wave, sys, types, unicodedata
import piper.phonemize_espeak as pe
# The v0.0.2 voice expects precomposed IPA (ç); piper 1.8 decomposes to NFD.
pe.unicodedata = types.SimpleNamespace(normalize=lambda form, s: unicodedata.normalize('NFC', s))
from piper import PiperVoice, SynthesisConfig
v = PiperVoice.load(sys.argv[1])
cfg = SynthesisConfig(length_scale=1.04, noise_scale=0.6, noise_w_scale=0.8)
n = json.load(open('narration.json'))
out = {}
for s in n:
    p = f"audio/{s['id']}.wav"
    with wave.open(p, 'wb') as w:
        v.synthesize_wav(s['tts'], w, syn_config=cfg)
    with wave.open(p) as w: out[s['id']] = w.getnframes() / w.getframerate()
json.dump(out, open('audio/durations.json', 'w'))
print(json.dumps({k: round(x, 2) for k, x in out.items()}), 'total', round(sum(out.values()), 1))
