import * as XLSX from "xlsx";
import path from "path";
import { readFileSync } from "fs";

export type TicketRow = {
  Ticket_Number: string;
  Conversation_ID?: string;
  Priority?: string;
  Subject?: string;
  Description?: string;
  Category?: string;
  Module?: string;
  Resolution?: string;
  Status?: string;
  [key: string]: unknown;
};

export type KnowledgeArticleRow = {
  KB_Article_ID: string;
  Title?: string;
  Body?: string;
  Tags?: string;
  Module?: string;
  Category?: string;
  [key: string]: unknown;
};

export type ConversationRow = {
  Ticket_Number: string;
  Conversation_ID?: string;
  Transcript?: string;
  Issue_Summary?: string;
  [key: string]: unknown;
};

export type ScriptRow = {
  Script_ID: string;
  Script_Title?: string;
  Script_Purpose?: string;
  Module?: string;
  Category?: string;
  [key: string]: unknown;
};

export type LearningEventRow = {
  Event_ID: string;
  Trigger_Ticket_Number?: string;
  Trigger_Conversation_ID?: string;
  Detected_Gap?: string;
  Proposed_KB_Article_ID?: string;
  Draft_Summary?: string;
  Final_Status?: string;
  [key: string]: unknown;
};

export type KBLineageRow = {
  KB_Article_ID: string;
  Source_Type?: string;
  Source_ID?: string;
  Relationship?: string;
  Evidence_Snippet?: string;
  [key: string]: unknown;
};

let ticketsCache: TicketRow[] | null = null;
let knowledgeArticlesCache: KnowledgeArticleRow[] | null = null;
let conversationsCache: ConversationRow[] | null = null;
let scriptsCache: ScriptRow[] | null = null;
let learningEventsCache: LearningEventRow[] | null = null;
let kbLineageCache: KBLineageRow[] | null = null;
let qaPromptCache: string | null = null;

function getExcelPath(): string {
  return path.join(process.cwd(), "public", "SupportMind__Final_Data.xlsx");
}

export function loadTickets(): TicketRow[] {
  if (ticketsCache) return ticketsCache;
  const filePath = getExcelPath();
  const buffer = readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets["Tickets"];
  if (!ws) {
    ticketsCache = [];
    return ticketsCache;
  }
  ticketsCache = XLSX.utils.sheet_to_json<TicketRow>(ws);
  return ticketsCache;
}

export function loadKnowledgeArticles(): KnowledgeArticleRow[] {
  if (knowledgeArticlesCache) return knowledgeArticlesCache;
  const filePath = getExcelPath();
  const buffer = readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets["Knowledge_Articles"];
  if (!ws) {
    knowledgeArticlesCache = [];
    return knowledgeArticlesCache;
  }
  knowledgeArticlesCache = XLSX.utils.sheet_to_json<KnowledgeArticleRow>(ws);
  return knowledgeArticlesCache;
}

export function getTicketById(ticketId: string): TicketRow | undefined {
  const tickets = loadTickets();
  return tickets.find((t) => String(t.Ticket_Number) === String(ticketId));
}

export function getTicketsForQueue(limit = 5): TicketRow[] {
  const tickets = loadTickets();
  return tickets.slice(0, limit);
}

export function loadConversations(): ConversationRow[] {
  if (conversationsCache) return conversationsCache;
  const filePath = getExcelPath();
  const buffer = readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets["Conversations"];
  if (!ws) {
    conversationsCache = [];
    return conversationsCache;
  }
  conversationsCache = XLSX.utils.sheet_to_json<ConversationRow>(ws);
  return conversationsCache;
}

export function getConversationByTicketNumber(ticketNumber: string): ConversationRow | undefined {
  const convos = loadConversations();
  return convos.find((c) => String(c.Ticket_Number) === String(ticketNumber));
}

/** Tickets with conversation transcript attached (for demo: "learning from conversation"). */
export function getTicketsForQueueWithTranscript(limit = 5): (TicketRow & { transcript?: string })[] {
  const tickets = getTicketsForQueue(limit);
  const convos = loadConversations();
  const byTicket = new Map(convos.map((c) => [String(c.Ticket_Number), c]));
  return tickets.map((t) => {
    const conv = byTicket.get(String(t.Ticket_Number));
    return { ...t, transcript: conv?.Transcript };
  });
}

/** Extract significant words for RAG search (no stopwords, lowercase). */
export function extractSearchTerms(text: string): string[] {
  const stop = new Set(
    "a an the and or but in on at to for of with by from as is was are were be been being have has had do does did will would could should may might must shall can need dare ought used".split(
      " "
    )
  );
  const words = (text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.has(w));
  return [...new Set(words)];
}

/** Find KB articles that match any of the search terms (in Title, Body, Tags). */
export function searchKnowledgeArticles(
  searchTerms: string[],
  limit = 10
): KnowledgeArticleRow[] {
  const articles = loadKnowledgeArticles();
  const scored = articles.map((art) => {
    const title = (art.Title ?? "").toLowerCase();
    const body = (art.Body ?? "").toLowerCase();
    const tags = (art.Tags ?? "").toLowerCase();
    const combined = `${title} ${body} ${tags}`;
    let score = 0;
    for (const term of searchTerms) {
      if (combined.includes(term)) score += 1;
    }
    return { art, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map((s) => s.art);
}

function loadWorkbook() {
  const filePath = getExcelPath();
  const buffer = readFileSync(filePath);
  return XLSX.read(buffer, { type: "buffer" });
}

export function loadScripts(): ScriptRow[] {
  if (scriptsCache) return scriptsCache;
  const wb = loadWorkbook();
  const ws = wb.Sheets["Scripts_Master"];
  if (!ws) {
    scriptsCache = [];
    return scriptsCache;
  }
  scriptsCache = XLSX.utils.sheet_to_json<ScriptRow>(ws);
  return scriptsCache;
}

export function searchScripts(searchTerms: string[], limit = 5): ScriptRow[] {
  const scripts = loadScripts();
  const scored = scripts.map((s) => {
    const title = (s.Script_Title ?? "").toLowerCase();
    const purpose = (s.Script_Purpose ?? "").toLowerCase();
    const cat = (s.Category ?? "").toLowerCase();
    const combined = `${title} ${purpose} ${cat}`;
    let score = 0;
    for (const term of searchTerms) {
      if (combined.includes(term)) score += 1;
    }
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((x) => x.score > 0)
    .slice(0, limit)
    .map((x) => x.s);
}

export function loadLearningEvents(): LearningEventRow[] {
  if (learningEventsCache) return learningEventsCache;
  const wb = loadWorkbook();
  const ws = wb.Sheets["Learning_Events"];
  if (!ws) {
    learningEventsCache = [];
    return learningEventsCache;
  }
  learningEventsCache = XLSX.utils.sheet_to_json<LearningEventRow>(ws);
  return learningEventsCache;
}

export function loadKBLineage(): KBLineageRow[] {
  if (kbLineageCache) return kbLineageCache;
  const wb = loadWorkbook();
  const ws = wb.Sheets["KB_Lineage"];
  if (!ws) {
    kbLineageCache = [];
    return kbLineageCache;
  }
  kbLineageCache = XLSX.utils.sheet_to_json<KBLineageRow>(ws);
  return kbLineageCache;
}

export function getQAEvaluationPromptText(maxChars = 3000): string {
  if (qaPromptCache) return qaPromptCache.slice(0, maxChars);
  const wb = loadWorkbook();
  const ws = wb.Sheets["QA_Evaluation_Prompt"];
  if (!ws) return "";
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  let text = "";
  for (const row of rows) {
    if (row && row[0]) text += String(row[0]) + "\n";
  }
  qaPromptCache = text;
  return text.slice(0, maxChars);
}
