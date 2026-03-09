# Interview Assistant

Production-ready AI-powered interview screening pipeline built with **LangGraph.js**, **Google Gemini**, **Node.js**, and **Pug**.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Express Server (server.js)                                │
│  ┌──────────┐  ┌───────────┐  ┌────────────────────────┐  │
│  │ Admin UI │  │ Upload UI │  │ REST API               │  │
│  │ (Pug)    │  │ (Pug)     │  │ GET /api/candidates    │  │
│  └──────────┘  └───────────┘  └────────────────────────┘  │
│                                                            │
│  ┌─────────────── LangGraph Workflow ───────────────────┐  │
│  │ check_domain → analyze_resume → invite / reject      │  │
│  │                                   ↓ (interrupt)      │  │
│  │                              analyze_video → Done     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌───────────┐  ┌────────────┐  ┌───────────────────────┐ │
│  │ PostgreSQL│  │ Nodemailer │  │ MCP (optional)        │ │
│  └───────────┘  └────────────┘  └───────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Workflow Nodes

| Node | Purpose |
|---|---|
| `check_domain_and_duplicate` | Validate sender email domain, SHA-256 resume dedup |
| `analyze_resume_rag` | Chunk JD → embed → vector search → Gemini Flash scoring |
| `invite_candidate` | Send invite email, pause graph (`interrupt()`) |
| `reject_candidate` | Send rejection email |
| `analyze_video` | Gemini Pro multimodal analysis of uploaded video |

## Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14 (running and accessible)
- **Google Cloud** API key with Generative AI API enabled
- **Gmail** account with an [App Password](https://support.google.com/accounts/answer/185833)

## Setup

### 1. Clone & install

```bash
cd interview_agent
npm install
```

### 2. Create the PostgreSQL database

```sql
CREATE DATABASE interview_assistant;
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Description |
|---|---|
| `GOOGLE_API_KEY` | Google Gemini API key |
| `GMAIL_USER` | Gmail address for sending emails |
| `GMAIL_APP_PASSWORD` | Gmail app password (not account password) |
| `PGHOST` | PostgreSQL host (default `localhost`) |
| `PGPORT` | PostgreSQL port (default `5432`) |
| `PGUSER` | PostgreSQL username |
| `PGPASSWORD` | PostgreSQL password |
| `PGDATABASE` | Database name (default `interview_assistant`) |
| `PORT` | Server port (default `3000`) |

### 4. Run

```bash
npm start
```

The server will:
1. Validate required env vars
2. Connect to PostgreSQL and create tables/seed settings
3. Initialise MCP clients (falls back to Nodemailer + local disk)
4. Compile the LangGraph workflow with PostgresSaver checkpoint
5. Start Express on the configured port

Open **http://localhost:3000/admin** in your browser.

## Usage

### Admin Dashboard (`/admin`)

- **Settings panel** — edit the Job Description, domain filter regex, and pass threshold (0–100 slider)
- **Trigger Screening** — upload a candidate email + resume PDF to start the pipeline
- **Candidates table** — live-updates every 5 seconds via polling

### Candidate Flow

1. Admin triggers screening with an email and resume
2. System validates domain, checks for duplicate resumes
3. Resume is scored against the JD using RAG + Gemini Flash
4. If score ≥ threshold → candidate receives an invite email with a video upload link
5. If score < threshold → candidate receives a rejection email
6. Candidate uploads a video at `/upload/:threadId`
7. Gemini Pro analyses the video for English fluency and technical skills
8. Candidate status updates to **Done**

### API

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin` | Admin dashboard |
| `POST` | `/admin/settings` | Update JD, domain filter, threshold |
| `POST` | `/admin/trigger` | Start pipeline (email + resume) |
| `GET` | `/upload/:threadId` | Candidate video upload page |
| `POST` | `/upload/:threadId` | Submit video |
| `GET` | `/api/candidates` | JSON list of all candidates |

## File Structure

```
├── server.js        Express server, routes, startup
├── graph.js         LangGraph workflow (state, nodes, edges)
├── db.js            PostgreSQL pool, query helper, schema init
├── mcp.js           MCP client setup with graceful fallback
├── views/
│   ├── layout.pug   Base layout (dark theme, sidebar)
│   ├── admin.pug    Dashboard with settings + candidates
│   └── upload.pug   Drag-and-drop video upload page
├── uploads/         Video files (created at runtime)
├── package.json
├── .env.example
└── README.md
```

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Web:** Express.js + Pug
- **AI:** Google Gemini via `@langchain/google-genai`
  - `gemini-1.5-flash` — text reasoning / resume scoring
  - `gemini-1.5-pro` — multimodal video analysis
  - `text-embedding-004` — embeddings
- **Orchestration:** LangGraph.js (`@langchain/langgraph`)
- **Database:** PostgreSQL via `pg`
- **Checkpointing:** `@langchain/langgraph-checkpoint-postgres` (falls back to `MemorySaver`)
- **Email:** Nodemailer (Gmail)
- **File uploads:** Multer
- **MCP:** `@modelcontextprotocol/sdk` (optional, graceful fallback)
