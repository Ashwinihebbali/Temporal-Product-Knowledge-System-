# ChronoDev AI — Autonomous Product History & Knowledge Graph 

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.1-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-7.0-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![Neo4j](https://img.shields.io/badge/Neo4j-5--Community-008CC1.svg?logo=neo4j&logoColor=white)](https://neo4j.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1.svg?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Ollama](https://img.shields.io/badge/Ollama-llama3.2:3b-black.svg?logo=ollama&logoColor=white)](https://ollama.com)

**ChronoDev AI** is a temporal product-record knowledge platform and evidence-grounded AI assistant built for the **Apache Axis2** ecosystem. It traces software evolution across 32,500+ dated milestones, extracts canonical feature identities, cross-links multi-model knowledge graphs, and performs strict evidence-grounded Q&A via local Ollama models.

---

## 🌟 Key Capabilities

- **Executive Mission Control**: High-level KPI telemetry, pipeline architecture flow (`Axis2 Dataset → PostgreSQL → Neo4j → Ollama 3.2`), and recent milestones.
- **Interactive Dual-Mode Timeline**:
  - **Gantt Swimlanes**: Canonical features on Y, dynamic time scale on X with color-coded stage halos (`implemented`, `change`, `decision`, `event`).
  - **Chronological Stream**: Vertical feed with author initials, confidence metrics, and grounded objectives.
- **Knowledge Graph Explorer**: Interactive 2D Cytoscape network with layout switching (`Concentric`, `Cose / Physics`, `Circle`, `Grid`), live node search, neighborhood focusing, and floating glass inspector.
- **Grounded AI Research Assistant**: Multi-turn conversational chat powered by local `llama3.2:3b`. Includes interactive citation pills (`[issue:...]`, `[commit:...]`, `[event:...]`) that open detail drawers with verbatim evidence quotes.
- **Time Machine (As-Of Historical State)**: Reconstruct project capability state as of any date between 2004 and 2026.
- **Jira Issue & Git Commit Hub**: Search ticket history, review discussion comments, and trace linked commits with author and diff metadata.
- **Quality Audit & Review Flags**: Automated conflict detection and data integrity auditing across features and timestamps.
- **Incremental Ingestion**: Add individual records or batch JSON imports with automatic deduplication and Ollama feature extraction.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│               ChronoDev Web Frontend                  │
│   (React 19 + Vite 7 + Cytoscape + Cyber Glassmorphism)│
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / REST
┌───────────────────────────▼────────────────────────────┐
│                  FastAPI Backend                       │
│    (Feature Store, History Store, Neo4j Sync Engine)   │
└───────┬───────────────────┬────────────────────┬───────┘
        │                   │                    │
┌───────▼────────┐  ┌───────▼────────┐  ┌────────▼───────┐
│   PostgreSQL   │  │  Neo4j Graph   │  │  Local Ollama  │
│(Source of Truth│  │(Semantic Links │  │(llama3.2:3b LLM│
│  & Milestones) │  │ & Hub Networks)│  │ & Extractions) │
└────────────────┘  └────────────────┘  └────────────────┘
```

---

## 🚀 Quick Start with Docker

### Prerequisites
- Docker & Docker Compose
- [Ollama](https://ollama.com) running locally with `llama3.2:3b` (`ollama pull llama3.2:3b && ollama run llama3.2:3b`)

### Launch All Services

```bash
cd backend
docker compose up -d --build
```

### Access Services
- **Web Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API Docs**: [http://localhost:8001/docs](http://localhost:8001/docs)
- **Neo4j Browser**: [http://localhost:7474](http://localhost:7474) (User: `neo4j`, Password: `chronodev-local`)
- **PostgreSQL**: `localhost:5432` (User: `chronodev`, Password: `chronodev-local`, DB: `chronodev`)

---

## 📁 Repository Structure

```
├── .vscode/               # Editor configurations
├── axis2_cleaned/         # Preprocessed Apache Axis2 datasets (CSVs & SQLite)
├── axis2_model/           # ML link prediction model and training artifacts
├── backend/               # FastAPI backend service, stores, and Docker setup
│   ├── config.py          # Environment settings
│   ├── data_service.py    # Axis2 data loader
│   ├── feature_store.py   # Canonical feature registry
│   ├── history_store.py   # PostgreSQL history store
│   ├── main.py            # API routes and Ollama integration
│   ├── neo4j_sync.py      # Background sync loop to Neo4j
│   ├── postgres_store.py  # PostgreSQL registry implementation
│   ├── docker-compose.yml # Docker orchestration
│   └── Dockerfile         # Python FastAPI container
├── frontend/              # Modern React 19 + Vite dashboard
│   ├── src/               # UI components, views, Cytoscape graph, and styles
│   ├── index.html         # HTML root with typography
│   ├── package.json       # Dependencies
│   └── Dockerfile         # Node 22 container
├── .dockerignore
└── .gitignore
```

---

## 📄 License
This project is developed for hackathon presentation and research purposes on Apache Axis2 software evolution.
