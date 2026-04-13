# ERV-Schnittstelle für den Legal AI Assistenten

> **Elektronischer Rechtsverkehr (ERV) Export** für den AI:SSOCIATE Legal AI
> Assistenten. Erzeugt aus Ergebnissen der Legal‑AI‑API strukturierte
> ERV‑konforme Pakete (XML‑Metadaten + PDF‑Anhänge), die sich direkt in
> österreichische Anwaltssoftware wie **Advokat**, **RA‑Micro AT**, **WinCaus**
> oder **Jurasoft** importieren lassen bzw. an einen ERV‑Gateway‑Provider
> (Postserver, BRZ, manz.at) übergeben werden können.

## Features

- **ERV‑Nachricht (österreichischer Strukturdatensatz)** — XML im
  `ervNachricht`‑Schema (webERV / BMJ / BRZ) mit `Kopfdaten`,
  `Grunddaten`, `Fachdaten` und eingebetteten Dokument‑Referenzen
  (R‑Code, Gerichts‑Code, Geschäftszahl).
- **Advokat‑Akten‑Import** — XML im Advokat‑kompatiblen Format mit
  Akt‑Stammdaten, Parteien, Dokument‑Liste.
- **ZIP‑Paket** — Nachricht + PDF‑Anhänge in einem Import‑fertigen Archiv
  mit Manifest (`manifest.json`).
- **Validierung** — XSD‑Validierung gegen die mitgelieferten Schemas.
- **REST‑API** — FastAPI‑Endpoints zum On‑the‑fly‑Generieren, Validieren,
  Paketieren und Herunterladen.
- **Legal‑AI‑Integration** — `/api/erv/from-ai` nimmt die Ausgabe der
  bestehenden LexWatch / Legal‑AI‑API entgegen und erzeugt daraus einen
  fertigen ERV‑Schriftsatz‑Entwurf.

## Quickstart

```bash
cd erv
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8100
```

Swagger‑UI: <http://localhost:8100/docs>

### Docker

```bash
docker compose -f docker-compose.yml up --build
```

## Endpoints

| Methode | Pfad                              | Beschreibung                                      |
|---------|-----------------------------------|---------------------------------------------------|
| GET     | `/api/erv/health`                 | Liveness‑Check                                    |
| GET     | `/api/erv/schemas`                | Liefert die mitgelieferten XSD‑Schemas            |
| POST    | `/api/erv/nachricht`              | Baut eine ERV‑Nachricht (XML) aus Strukturdaten   |
| POST    | `/api/erv/advokat`                | Baut ein Advokat‑Akten‑Import‑XML                 |
| POST    | `/api/erv/paket`                  | Packt Nachricht + PDF‑Anhänge zu einem ZIP        |
| POST    | `/api/erv/validieren`             | Validiert eine Nachricht gegen die XSDs           |
| POST    | `/api/erv/from-ai`                | Wandelt Legal‑AI‑Output in ERV‑Paket              |

## Datenfluss

```
Legal AI API (LexWatch / RIS Tracker)
        │
        ▼
 /api/erv/from-ai                       ┌─────────────────────┐
        │                               │                     │
        ▼                               ▼                     ▼
   ErvNachricht (Pydantic) ──▶ ERV‑XML (AT)    Advokat‑XML ──▶ Import Advokat
        │                               │
        ▼                               ▼
   ZIP‑Paket mit PDF‑Anhängen ─────────▶ ERV‑Gateway (Postserver, BRZ, …)
```

## Hinweise zu ERV‑Standards (Österreich)

Dieses Modul implementiert ausschließlich den **österreichischen
Elektronischen Rechtsverkehr (webERV)** — nicht XJustiz (Deutschland).
Die XML‑Struktur orientiert sich am Strukturdatensatz, wie ihn das
**Bundesministerium für Justiz (BMJ)** und das **Bundesrechenzentrum
(BRZ)** im ERV‑Handbuch publizieren: `ervNachricht` mit `Kopfdaten`
(Nachrichten‑Art, Empfänger‑Gerichtscode), `Grunddaten`
(Einbringer‑R‑Code, Parteien, Geschäftszahl) und `Fachdaten`
(Betreff, Verfahrensgegenstand, Urkunden‑/Beilagen‑Referenzen).

Da die offiziellen ERV‑XSDs nur an zugelassene Übermittlungsstellen
(Postserver, BRZ, manz.at) ausgegeben werden, liefert dieses Modul
am publizierten Datenmodell orientierte Eigen‑Schemas. Vor
Produktiveinsatz ist die generierte Nachricht gegen die aktuell
gültigen Originalschemas des eigenen Gateway‑Providers zu validieren.

**Advokat‑Import** basiert auf dem Akten‑XML‑Format, wie es die
Advokat Unternehmensberatung GmbH publiziert hat (Akt, Parteien,
Schriftstücke). Die Feldnamen dieses Moduls sind an die öffentlich
dokumentierten Advokat‑Import‑Felder angelehnt.

## Lizenz

Internes Projekt der AI:SSOCIATE — alle Rechte vorbehalten.
