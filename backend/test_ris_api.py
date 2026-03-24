"""Quick RIS API test script. Run inside the backend container:
   docker compose exec backend python3 test_ris_api.py
"""
import httpx

BASE = "https://data.bka.gv.at/ris/api/v2.6/Bundesrecht"

tests = [
    ("No filter (1 year)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr"}),
    ("No filter (Undefined)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "Undefined"}),
    ("Index=20 (1 year)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Index": "20"}),
    ("Index=10 (1 year)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Index": "10"}),
    ("Index=25 (1 year)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Index": "25"}),
    ("Suchworte=Recht (1 year)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Suchworte": "Recht"}),
    ("Suchworte=Verfassung (1 year)", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1, "ImRisSeit": "EinemJahr", "Suchworte": "Verfassung"}),
    ("No ImRisSeit", {"Applikation": "BrKons", "DokumenteProSeite": "Twenty", "Seitennummer": 1}),
]

for name, params in tests:
    try:
        r = httpx.get(BASE, params=params, timeout=15)
        d = r.json()
        res = d.get("OgdSearchResult", {})
        hits = res.get("OgdDocumentResults", {}).get("Hits", {}).get("Value", "N/A")
        err = res.get("Error", {}).get("Message", "")
        if err:
            print(f"  {name}: ERROR - {err}")
        else:
            print(f"  {name}: {hits} hits")
    except Exception as e:
        print(f"  {name}: EXCEPTION - {e}")
