# LexWatch — iSH Edition (iPhone)

Lightweight version of LexWatch that runs on **iSH** (Alpine Linux on iPhone) using **SQLite** instead of PostgreSQL. No Docker needed.

## What's different from the main project?

| Feature | Main Project | iSH Edition |
|---------|-------------|-------------|
| Database | PostgreSQL | SQLite (zero setup) |
| Deployment | Docker Compose | Direct Python + npm |
| Frontend | Nginx container | Served by FastAPI |
| Everything else | Same | Same |

## Quick Start on iSH

### 1. Install iSH from the App Store

Download **iSH Shell** from the iOS App Store.

### 2. Clone the repo

```sh
apk add git
git clone https://github.com/philippos121/Mainu.git
cd Mainu/lexwatch-ish
```

### 3. Run the setup script (one-time, ~15-20 min on iSH)

```sh
sh setup-ish.sh
```

This installs Python, Node.js, builds the frontend, and sets up the backend.

### 4. (Optional) Add your OpenAI API key

```sh
vi .env
```

Add your key to `OPENAI_API_KEY=sk-...` for AI-powered summaries. Without it, the app still works but shows a placeholder instead of AI summaries.

### 5. Start the app

```sh
sh start.sh
```

### 6. Open in Safari

Go to **http://localhost:8000** in Safari on your iPhone.

## Usage

1. **Register** a new account
2. **Select interests** (legal categories) in your profile
3. **Trigger a scan** from the dashboard to import law changes from RIS
4. **Browse** all law changes or view your personalized **feed**
5. **Notifications** alert you when changes match your interests

## Troubleshooting

**"npm install" is very slow:**
This is expected on iSH (x86 emulation on ARM). Let it run — it works, just takes time.

**"pip install" fails with compiler errors:**
Make sure you ran `apk add gcc musl-dev python3-dev libffi-dev openssl-dev make g++` first.

**App won't start — port in use:**
Kill any previous instance: `pkill -f uvicorn`, then try again.

**Want to reset the database:**
```sh
rm backend/lexwatch.db
```
The database is recreated automatically on next start.
