# ERV Österreich — Hinweise zum Strukturdatensatz

> Dieses Modul implementiert **ausschließlich** den österreichischen
> Elektronischen Rechtsverkehr (**webERV**). Es hat **nichts** mit dem
> deutschen **XJustiz**-Standard zu tun.

## Kernbegriffe

| Begriff          | Bedeutung                                                         |
|------------------|-------------------------------------------------------------------|
| **ERV**          | Elektronischer Rechtsverkehr (Österreich, seit 1990 / webERV 2007)|
| **webERV**       | Moderne Web-Variante des ERV (XML + Anhänge über Gateway)         |
| **R-Code**       | ERV-Teilnehmer-Kennung einer Anwaltskanzlei / Notars              |
| **Gerichts-Code**| Numerische ID eines Gerichts im ERV (z.B. `0017` = BG Innere Stadt Wien) |
| **Geschäftszahl**| Aktenzeichen des Gerichts (z.B. `4 C 123/26`)                     |
| **Übermittlungsstelle** | Zugelassener Gateway-Provider (Postserver, BRZ, manz.at)   |
| **StrEBr**       | Strukturierter Elektronischer Brief (ERV-Nachricht)               |

## Datenfluss in der Praxis

```
Kanzlei-Software  ──▶  ERV-Nachricht (XML + PDF-Anhänge)
        │                    │
        │                    ▼
        │             Übermittlungsstelle (Postserver/BRZ/manz)
        │                    │
        │                    ▼
        │             Justiz-Empfangsstelle (BMJ / Gericht)
        │                    │
        ▼                    ▼
   Rückverkehr (Erledigungen, Zustellungen) ◀── Gericht
```

## Nachrichten-Arten (Kopfdaten/NachrichtenArt)

| Code | Bedeutung                           |
|------|-------------------------------------|
| `SV` | Schriftsatz / Schriftstück          |
| `KL` | Klage                               |
| `MA` | Mahnklage                           |
| `AN` | Antrag                              |
| `RM` | Rechtsmittel (Berufung/Revision/…)  |
| `ZV` | Zustellverfügung                    |
| `EX` | Exekutionsantrag                    |
| `GB` | Grundbuchantrag                     |
| `FB` | Firmenbuchantrag                    |
| `SO` | Sonstiges                           |

## Pflichtfelder für eine Einbringung

1. **Einbringer.RCode** — die R-Code-Kennung der Kanzlei.
2. **Gericht.GerichtsCode** — Ziel-Gericht des Schriftsatzes.
3. **NachrichtenArt** — Code aus obiger Tabelle.
4. **Betreff / Verfahrensgegenstand** — Klartext‑Bezeichnung.
5. **Dokumente** — mindestens ein PDF‑Anhang (idealerweise PDF/A-2b).

## Unterschiede zu XJustiz (DE)

| Aspekt           | ERV (Österreich)                       | XJustiz (Deutschland)            |
|------------------|----------------------------------------|----------------------------------|
| Standardisierung | BMJ / BRZ, ÖRAK                        | Bund-Länder-Kommission / XÖV     |
| Transport        | Postserver, BRZ, manz.at Gateways      | OSCI / EGVP / beA                |
| Kennung Anwalt   | R-Code (z.B. R123456)                  | SAFE-ID / beA-SAFE               |
| Gerichtskennung  | ERV-Gerichts-Code (numerisch 4‑stellig)| Gerichtsschlüssel der JM         |
| XML-Root         | `ervNachricht` bzw. `StrEBr`           | `xjustiz.nachricht`              |

Dieses Modul benutzt eine eigene XSD am Muster des publizierten
österreichischen Strukturdatensatzes. Vor Echteinsatz ist das XML
gegen die Originalschemas des zugelassenen Übermittlungsanbieters zu
validieren.
