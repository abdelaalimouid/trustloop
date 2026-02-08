"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getTicketById,
  loadKnowledgeArticles,
  searchKnowledgeArticles,
  searchScripts,
  extractSearchTerms,
  getQAEvaluationPromptText,
} from "@/lib/excel-parser";
import { parseJsonSafe } from "@/lib/json";

export type LearnedArticle = {
  id: string;
  title: string;
  body: string;
  ticketId: string;
};

export type KnowledgeSource = {
  id: string;
  title: string;
  snippet: string;
  source: "seed" | "learned";
  ticketId?: string;
};

export type RecommendedResource = {
  type: "KB" | "SCRIPT";
  id: string;
  title?: string;
};

export type AnalyzeTicketResult = {
  solution: string;
  confidence_score: number;
  new_knowledge_draft: string | null;
  compliance_status: "SAFE" | "UNSAFE" | "UNKNOWN";
  sources_used: KnowledgeSource[];
  recommended_resource: RecommendedResource | null;
  qa_score: number | null;
  red_flags: string[];
  coaching_tip: string | null;
  error?: string;
};

export async function analyzeTicket(
  ticketId: string,
  transcript: string,
  learnedArticles: LearnedArticle[] = []
): Promise<AnalyzeTicketResult> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    return {
      solution: "Error: Gemini API key not configured.",
      confidence_score: 0,
      new_knowledge_draft: null,
      compliance_status: "UNKNOWN",
      sources_used: [],
      recommended_resource: null,
      qa_score: null,
      red_flags: [],
      coaching_tip: null,
      error: "Missing API key",
    };
  }

  const ticket = getTicketById(ticketId);
  const issueText = transcript || ticket?.Description || ticket?.Subject || "No description provided.";
  const searchTerms = extractSearchTerms(issueText);
  const relevantArticles = searchKnowledgeArticles(searchTerms, 6);
  const relevantScripts = searchScripts(searchTerms, 3);

  const contextParts: string[] = [];

  if (learnedArticles.length > 0) {
    contextParts.push(
      "## Previously learned articles (from this system; include these in the knowledge base):\n" +
        learnedArticles
          .map(
            (a) =>
              `[${a.id} from Ticket ${a.ticketId}] ${a.title}\n${(a.body ?? "").slice(0, 1200)}`
          )
          .join("\n\n---\n\n")
    );
  }

  let seedArticles = relevantArticles;
  if (relevantArticles.length > 0) {
    contextParts.push(
      "## Seed knowledge base:\n" +
        relevantArticles
          .map(
            (a) =>
              `[${a.KB_Article_ID}] ${a.Title || ""}\n${(a.Body || "").slice(0, 1200)}`
          )
          .join("\n\n---\n\n")
    );
  } else {
    const all = loadKnowledgeArticles();
    seedArticles = all.slice(0, 5);
    const fallback = seedArticles
      .map(
        (a) =>
          `[${a.KB_Article_ID}] ${a.Title || ""}\n${(a.Body || "").slice(0, 800)}`
      )
      .join("\n\n---\n\n");
    if (fallback.trim()) contextParts.push("## Seed knowledge base:\n" + fallback);
  }

  const context =
    contextParts.length > 0
      ? contextParts.join("\n\n")
      : "No knowledge articles available in the database.";

  const sources_used: KnowledgeSource[] = [
    ...learnedArticles.map((a) => ({
      id: a.id,
      title: a.title,
      snippet: (a.body ?? "").slice(0, 200),
      source: "learned" as const,
      ticketId: a.ticketId,
    })),
    ...seedArticles.map((a) => ({
      id: a.KB_Article_ID,
      title: (a.Title ?? "").slice(0, 120),
      snippet: (a.Body ?? "").slice(0, 200),
      source: "seed" as const,
    })),
  ];

  const prompt = `You are a RealPage Support Agent. Use the following context from the knowledge base (seed + any previously learned articles) to answer the customer.

${context}

## Customer Issue (from ticket/transcript)
${issueText}

## Instructions (self-learning)
1. If the answer EXISTS in the context above (including in "Previously learned articles" or seed KB), provide a clear, step-by-step solution and set confidence_score between 0.8 and 1.0. Set new_knowledge_draft to null — do NOT propose a duplicate article.
2. If the answer is NOT in the context, infer a reasonable solution and DRAFT a NEW Knowledge Base article (title + body). Set confidence_score between 0.3 and 0.7. Set new_knowledge_draft to the draft text.
3. Recommend the best resource for this issue: either a KB article from the context (use its ID) or a Tier 3 script. Script IDs provided: ${relevantScripts.map((s) => s.Script_ID + " " + (s.Script_Title ?? "")).join("; ")}.
4. Reply in this exact JSON format only (no markdown code fence, no extra text):
{"solution":"<full solution text>","confidence_score":<number 0-1>,"new_knowledge_draft":<null or "Title: ...\\n\\nBody: ...">,"recommended_resource":{"type":"KB"|"SCRIPT","id":"<KB_Article_ID or Script_ID>","title":"<short title>"}}`;


  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text()?.trim() || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    const parsed = parseJsonSafe<{
      solution?: string;
      confidence_score?: number;
      new_knowledge_draft?: string | null;
      recommended_resource?: { type?: string; id?: string; title?: string };
    }>(jsonStr);

    const solution = parsed.solution ?? "No solution generated.";
    let compliance_status: "SAFE" | "UNSAFE" | "UNKNOWN" = "UNKNOWN";
    const qaPromptShort = getQAEvaluationPromptText(2000);
    let qa_score: number | null = null;
    let red_flags: string[] = [];
    let coaching_tip: string | null = null;

    try {
      const [complianceRes, qaRes] = await Promise.all([
        model.generateContent(
          `Does this support response contain PII, full payment details, or unsafe/harmful instructions? Reply with exactly one word: SAFE or UNSAFE.\n\nResponse:\n${solution.slice(0, 1200)}`
        ),
        model.generateContent(
          `You are a QA analyst. Score this support resolution (0-100) and give one short coaching tip. If PII/PCI/unsafe set red_flags and qa_score 0. Otherwise score clarity.\n\n${qaPromptShort.slice(0, 1200)}\n\nResolution:\n${solution.slice(0, 1000)}\n\nReply JSON only: {"qa_score":<0-100>,"red_flags":[] or ["issue"],"coaching_tip":"one sentence"}`
        ),
      ]);
      const complianceText = complianceRes.response.text()?.trim()?.toUpperCase() ?? "";
      compliance_status = complianceText.includes("UNSAFE") ? "UNSAFE" : "SAFE";
      const qaText = qaRes.response.text()?.trim() ?? "";
      const qaMatch = qaText.match(/\{[\s\S]*\}/);
      if (qaMatch) {
        const qaParsed = parseJsonSafe<{ qa_score?: number; red_flags?: string[]; coaching_tip?: string }>(qaMatch[0]);
        qa_score = typeof qaParsed.qa_score === "number" ? Math.max(0, Math.min(100, qaParsed.qa_score)) : null;
        red_flags = Array.isArray(qaParsed.red_flags) ? qaParsed.red_flags.filter((x) => typeof x === "string") : [];
        coaching_tip = typeof qaParsed.coaching_tip === "string" && qaParsed.coaching_tip.trim() ? qaParsed.coaching_tip.trim() : null;
      }
    } catch {
      /* compliance/QA optional */
    }

    let recommended_resource: RecommendedResource | null = null;
    const rr = parsed.recommended_resource;
    if (rr && rr.type && rr.id && (rr.type === "KB" || rr.type === "SCRIPT")) {
      recommended_resource = {
        type: rr.type as "KB" | "SCRIPT",
        id: String(rr.id),
        title: rr.title ? String(rr.title).slice(0, 120) : undefined,
      };
    }

    return {
      solution,
      confidence_score: Math.min(1, Math.max(0, Number(parsed.confidence_score) ?? 0.5)),
      new_knowledge_draft:
        parsed.new_knowledge_draft && String(parsed.new_knowledge_draft).trim()
          ? String(parsed.new_knowledge_draft).trim()
          : null,
      compliance_status,
      sources_used,
      recommended_resource,
      qa_score,
      red_flags,
      coaching_tip,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      solution: `Analysis failed: ${message}`,
      confidence_score: 0,
      new_knowledge_draft: null,
      compliance_status: "UNKNOWN",
      sources_used: [],
      recommended_resource: null,
      qa_score: null,
      red_flags: [],
      coaching_tip: null,
      error: message,
    };
  }
}
