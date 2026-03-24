"""Quick RIS API test script. Run inside the backend container:
   docker compose exec backend python3 test_ris_api.py
"""
import httpx, json

BASE = "https://data.bka.gv.at/ris/api/v2.6/Bundesrecht"

# Fetch one result and show the URL fields
r = httpx.get(BASE, params={
    "Applikation": "BrKons",
    "DokumenteProSeite": "Twenty",
    "Seitennummer": 1,
    "ImRisSeit": "DreiMonaten",
    "Suchworte": "Strafrecht",
}, timeout=15)
d = r.json()
refs = d.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
if isinstance(refs, dict):
    refs = [refs]

print(f"Found {len(refs)} refs")
for i, ref in enumerate(refs[:3]):
    data = ref.get("Data", {})
    meta = data.get("Metadaten", {})
    allg = meta.get("Allgemein", {})
    tech = meta.get("Technisch", {})
    br = meta.get("Bundesrecht", {})
    brk = {}
    if isinstance(br, dict):
        brk = br.get("BrKons", {}) if isinstance(br.get("BrKons"), dict) else {}

    print(f"\n--- Result {i+1} ---")
    print(f"  ID: {tech.get('ID', '?')}")
    print(f"  Allgemein.DokumentUrl: {allg.get('DokumentUrl', 'N/A')}")
    print(f"  Bundesrecht.Eli: {br.get('Eli', 'N/A')}")
    print(f"  Kurztitel: {br.get('Kurztitel', 'N/A')}")
    print(f"  ArtikelParagraphAnlage: {brk.get('ArtikelParagraphAnlage', 'N/A')}")
    print(f"  Kundmachungsorgan: {brk.get('Kundmachungsorgan', 'N/A')}")
    # Show all keys in BrKons
    print(f"  BrKons keys: {list(brk.keys()) if isinstance(brk, dict) else 'N/A'}")
