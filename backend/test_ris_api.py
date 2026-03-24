"""Quick RIS API test script. Run inside the backend container:
   docker compose exec backend python3 test_ris_api.py
"""
import httpx

BASE = "https://data.bka.gv.at/ris/api/v2.6/Bundesrecht"


def test(name, params):
    r = httpx.get(BASE, params=params, timeout=15)
    d = r.json()
    doc_results = d.get("OgdSearchResult", {}).get("OgdDocumentResults", {})
    hits_obj = doc_results.get("Hits", {})
    hits = hits_obj.get("#text", "N/A") if isinstance(hits_obj, dict) else str(hits_obj)
    refs = doc_results.get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    n_refs = len(refs) if refs else 0
    print(f"  {name}: {hits} hits, {n_refs} refs")


print("=== Bundesrecht: Single keywords (1 month) ===")
keywords = ["Verfassung", "ABGB", "Strafrecht", "Verwaltung", "Steuer",
            "Arbeit", "Gewerbe", "Miet", "Umwelt", "Verkehr",
            "Gesundheit", "Medien", "Datenschutz", "Unterricht", "Familie", "Europa"]
for kw in keywords:
    test(f"Suchworte={kw}", {
        "Applikation": "BrKons", "DokumenteProSeite": "Twenty",
        "Seitennummer": 1, "ImRisSeit": "EinemMonat", "Suchworte": kw,
    })

print("\n=== Baseline (no filter) ===")
test("No filter (1mo)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemMonat"})
test("No filter (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr"})
