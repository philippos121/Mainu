# Messung der Due Diligence

`eval/run.mjs` misst eine abgeschlossene Due Diligence gegen die Erwartung eines Reviewers.
Es ist für Regressionstests nach jeder Änderung an Prompts, Katalogen oder Regeln gedacht.
Echte Akten gehören nicht ins Repository: Die Erwartungsdatei liegt beim Akt und wird mit `--expected` übergeben.

```
node eval/run.mjs --data /data --matter m_xxx --expected /pfad/zum/akt.expected.json
```

Gemessen wird:

| Kennzahl | Ziel |
|---|---|
| Trefferquote hoch (erwartete rote Themen als rot gefunden) | 100 % |
| Trefferquote gesamt | ≥ 80 % |
| Genauigkeit rot (gemeldete rote Themen, die rot erwartet sind) | ≥ 80 % |
| doppelte Themen | 0 |
| Fallen (Konstellationen, die kein Thema sein dürfen) | 0 |
| Belegquote (Themen mit Beleg in einer Originalunterlage) | 100 % |
| Wörter im Red-Flag-Bericht | ≤ 15.000 |

Die Datei `expected.example.json` zeigt das Format: Je Thema gibt es ein Suchmuster (`match`, regulärer Ausdruck über Titel, Schlüssel und Beschreibung) und den erwarteten Grad. Unter `traps` stehen die Fallen.

Zusätzlich gibt das Werkzeug je Akt-Regel (und für Klauseln, Akt-Durchgang und Hypothesen) aus, wie viele Themen entstanden sind und wie viele davon nicht gehalten haben. Nicht gehalten heißt: in der Prüfung widerlegt, im Ausschlusskatalog, rechtlich nicht zutreffend oder im Review verworfen. Ist der Anteil hoch (ab 50 % bei mindestens 3 Themen, markiert mit „prüfen“), schlägt die Regel zu oft an. Dieselbe Bilanz steht im Protokoll-Tab des Akts und im Excel-Blatt „Regeln“.
