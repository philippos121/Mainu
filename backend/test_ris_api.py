"""Quick RIS API test script. Run inside the backend container:
   docker compose exec backend python3 test_ris_api.py
"""
import httpx, json

BASE = "https://data.bka.gv.at/ris/api/v2.6/Bundesrecht"

# First: dump full response structure for one simple query
print("=== RAW RESPONSE (no filter, 1 year) ===")
r = httpx.get(BASE, params={
    "Applikation": "BrKons",
    "DokumenteProSeite": "Twenty",
    "Seitennummer": 1,
    "ImRisSeit": "EinemJahr",
}, timeout=15)
d = r.json()
# Print top-level keys
print(f"Status: {r.status_code}")
print(f"Top keys: {list(d.keys())}")
# Print nested structure (first 2000 chars)
print(json.dumps(d, indent=2, ensure_ascii=False)[:2000])
