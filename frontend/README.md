# ChronoDev frontend

React + Vite dashboard for the FastAPI backend. It shows the dated history, source evidence, feature graph, review flags, and local Ollama Q&A.

## Run locally

Install Node.js LTS if `node --version` and `npm --version` are not available. From this folder:

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Keep FastAPI running at `http://127.0.0.1:8000` and PostgreSQL/Neo4j running with `docker compose up -d` from `backend`.
