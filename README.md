# LexWatch — Österreichischer Rechtsänderungs-Tracker

Ein vollständiger Web-Applikation zur Überwachung von Änderungen in der österreichischen Gesetzgebung. Nutzt die **RIS (Rechtsinformationssystem) API** des BKA und **OpenAI GPT** für KI-gestützte Zusammenfassungen.

## Features

- **Benutzerregistrierung & Login** — JWT-basierte Authentifizierung
- **Personalisierte Interessen** — Wählen Sie Rechtsgebiete und Suchbegriffe im Profil
- **Täglicher RIS-Scan** — Automatischer Import neuer Rechtsänderungen um 06:00 UTC
- **KI-Zusammenfassungen** — Verständliche Zusammenfassungen jeder Änderung (OpenAI GPT)
- **Benachrichtigungen** — Personalisierte Alerts bei relevanten Änderungen
- **Suche & Filter** — Freitext, Kategorie, Datum
- **Responsive Dark/Light UI** — Modernes Glasmorphismus-Design mit Vuetify 3

## Tech-Stack

| Schicht    | Technologie                    |
|------------|--------------------------------|
| Frontend   | Vue 3, Vuetify 3, Pinia, Vite |
| Backend    | FastAPI, SQLAlchemy 2, Pydantic 2 |
| Datenbank  | PostgreSQL 16                  |
| KI         | OpenAI GPT API                 |
| Datenquelle| RIS OGD API v2.6               |
| Deployment | Docker Compose                 |

## Schnellstart

### 1. Repository klonen & .env einrichten

```bash
cp .env.example .env
# OpenAI API Key in .env eintragen
```

### 2. Mit Docker Compose starten

```bash
docker compose up --build
```

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000
- **API Docs:** http://localhost:8000/docs

### 3. Ohne Docker (Entwicklung)

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## API-Endpunkte

| Methode | Pfad                            | Beschreibung                     |
|---------|---------------------------------|----------------------------------|
| POST    | `/api/auth/register`            | Benutzer registrieren            |
| POST    | `/api/auth/login`               | Anmelden                        |
| GET     | `/api/users/me`                 | Profil abrufen                   |
| PATCH   | `/api/users/me`                 | Profil/Interessen aktualisieren  |
| GET     | `/api/law-changes`              | Alle Änderungen (paginiert)      |
| GET     | `/api/law-changes/my-feed`      | Personalisierter Feed            |
| GET     | `/api/law-changes/categories`   | Verfügbare Rechtsgebiete         |
| GET     | `/api/law-changes/{id}`         | Einzelne Änderung                |
| POST    | `/api/law-changes/scan`         | Manueller RIS-Scan               |
| GET     | `/api/law-changes/notifications/list` | Benachrichtigungen         |

## Projektstruktur

```
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI Router
│   │   ├── core/         # Config, DB, Security
│   │   ├── models/       # SQLAlchemy Models
│   │   ├── schemas/      # Pydantic Schemas
│   │   └── services/     # RIS Client, OpenAI, Scheduler
│   ├── alembic/          # DB Migrations
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/   # Vue-Komponenten
│   │   ├── views/        # Seiten
│   │   ├── stores/       # Pinia Stores
│   │   ├── router/       # Vue Router
│   │   └── services/     # API Client
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── .env.example
```
