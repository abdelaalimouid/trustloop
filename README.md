# TrustLoop — Self-Learning Support Intelligence

**RealPage SupportMind AI Challenge · Global AI Hackathon**

TrustLoop is a self-learning support intelligence dashboard that **triages tickets**, **recommends the best resource (KB vs script)**, **scores QA**, and **updates the knowledge base with full traceability** when the AI detects a gap. Built for the RealPage SupportMind AI brief: human-in-the-loop learning, lineage, and consistent QA.

---

## What it does

- **Queue:** Tickets from dataset + “Create new ticket” with AI-generated conversation-style suggestions. Recurring themes and batch simulation (analyze 3 tickets at once).
- **Action Center:** One-click **Analyze now** (RAG over KB + scripts + learned articles), thought process, transcript, AI solution, confidence, compliance, best resource (KB vs script), QA score, red flags, coaching tip, “Knowledge found here.”
- **Trust Loop (Governance):** When the AI detects a knowledge gap, a draft article appears. You can **Approve & Publish** (adds to Live KB with provenance and lineage) or **Dismiss draft**. “Review before publishing” warning when confidence or QA is low. Learning activity and session lineage persisted (localStorage).

---

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Google Gemini 2.5 Flash** — RAG, compliance check, QA scoring, ticket suggestions
- **ElevenLabs** — TTS for “Play call” (transcript → speech)
- **xlsx** — Load Tickets, Conversations, Knowledge_Articles, Scripts_Master, Learning_Events, KB_Lineage, QA_Evaluation_Prompt from the challenge Excel
- **Framer Motion**, **Tailwind CSS**, **lucide-react**

---

## Setup

### Prerequisites

- Node.js 18+
- npm (or yarn/pnpm)

### Install and run

```bash
cd trustloop
npm install
cp .env.example .env.local   # then add your API keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

Create `.env.local` in the project root:

```
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_key
NEXT_PUBLIC_ELEVENLABS_API_KEY=your_elevenlabs_key
```

- **Gemini:** Required for analysis, QA scoring, and ticket suggestions. Get key from [Google AI Studio](https://aistudio.google.com/).
- **ElevenLabs:** Optional; used for “Play call” (TTS). Without it, the button is disabled or you can mock.

### Dataset

Place the challenge Excel file at:

**`public/SupportMind__Final_Data.xlsx`**

Sheets used: Tickets, Conversations, Knowledge_Articles, Scripts_Master, Learning_Events, KB_Lineage, QA_Evaluation_Prompt.

---

## Scripts

| Command        | Description                |
|----------------|----------------------------|
| `npm run dev`  | Start dev server           |
| `npm run build`| Production build           |
| `npm run lint` | Run ESLint                 |

---

## Project structure

```
trustloop/
├── app/
│   ├── actions/        # analyzeTicket, suggestTickets (server actions)
│   ├── api/tts/        # ElevenLabs TTS route
│   ├── components/     # TrustLoopDashboard
│   ├── layout.tsx, page.tsx, globals.css
├── lib/
│   ├── excel-parser.ts # Load Excel, search KB/scripts, QA prompt
│   ├── json.ts        # Safe JSON parse for LLM output
│   ├── cn.ts          # className helper
├── public/
│   └── SupportMind__Final_Data.xlsx
├── docs/              # JUDGE_GUIDE, HOW_TO_USE, COMPLIANCE_AUDIT
├── .env.local         # API keys (not in repo)
└── README.md
```

---

## License

MIT.
