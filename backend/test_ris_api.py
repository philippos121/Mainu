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


print("=== Bundesrecht Tests ===")
test("No filter (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr"})
test("No filter (1mo)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemMonat"})
test("Index=20 (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Index": "20"})
test("Index=10 (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Index": "10"})
test("Index=25 (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Index": "25"})
test("Suchworte=Recht (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Suchworte": "Recht"})
test("Suchworte=Verfassung (1yr)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Suchworte": "Verfassung"})

print("\n=== Judikatur Test ===")
JUD_BASE = "https://data.bka.gv.at/ris/api/v2.6/Judikatur"
r = httpx.get(JUD_BASE, params={"Applikation": "Justiz", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr"}, timeout=15)
d = r.json()
doc_results = d.get("OgdSearchResult", {}).get("OgdDocumentResults", {})
hits_obj = doc_results.get("Hits", {})
hits = hits_obj.get("#text", "N/A") if isinstance(hits_obj, dict) else str(hits_obj)
refs = doc_results.get("OgdDocumentReference", [])
n_refs = len(refs) if isinstance(refs, list) else (1 if refs else 0)
print(f"  Justiz no filter (1yr): {hits} hits, {n_refs} refs")
