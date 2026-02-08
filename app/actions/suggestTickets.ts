"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseJsonSafe } from "@/lib/json";

export type SuggestedTicket = {
  Subject: string;
  Description: string;
  Priority: string;
  Category: string;
  /** Agent/Caller conversation transcript, same format as dataset (Conversations tab). */
  Transcript?: string;
};

const TRANSCRIPT_EXAMPLE = `Agent: ExampleCo Support, Casey speaking. What can I assist you with in PropertySuite Affordable?

Caller: Hi Casey, I'm Taylor Robinson with Riverbend Housing Group. I'm running into an issue at Hilltop Commons. Date advance fails because a backend certification reference is invalid and needs a update correction. I get a message that something is missing and it won't let me advance.

Agent: Got it. What screen are you on and what's the exact step that fails?

Caller: I'm in Settings → Property → Date Advance. It fails right when I try to save/submit.

Agent: Thanks. Let's check a couple quick things together.

Agent: Confirm there are no open batches (bank deposits, posting batches, or month-end tasks).

Caller: Okay, I checked that—here's what I see.

Agent: Verify the current property date and the next business date in the property calendar.

Caller: Okay, I checked that—here's what I see.

Agent: This looks like a data mismatch behind the scenes. I can get this fixed with a Tier 3 data correction.

Caller: Yes please—this is blocking today's work.

Agent: Understood. I'll apply the data fix and then have you retry.

Caller: I retried—now it goes through. That did it.

Agent: All set on my side. I'm documenting what we did and closing the ticket—reach out anytime.`;

export async function suggestTickets(
  userPrompt: string
): Promise<{ suggestions: SuggestedTicket[]; error?: string }> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    return { suggestions: [], error: "API key not configured" };
  }

  const prompt = `You are generating synthetic support tickets for a property management / RealPage-style support system. Each ticket MUST include a conversation transcript in the same format as the dataset: Agent/Caller dialogue with realistic back-and-forth (greeting, issue description, troubleshooting steps, resolution, closing). Use "Agent:" and "Caller:" prefixes; Agent represents ExampleCo Support; Caller gives their name, property, and issue. Keep each transcript to 8–14 exchanges. Match the tone and structure of this example:

---
${TRANSCRIPT_EXAMPLE}
---

Generate exactly 3 different ticket suggestions. Each ticket must have:
- Subject: short one-line summary
- Description: 1–2 sentence summary (for display in queue)
- Priority: High, Medium, or Low
- Category: e.g. "Advance Property Date", "Certifications", "General", "Unit Availability", "Syndication", "Billing"
- Transcript: the full Agent/Caller conversation (use \\n for newlines inside the JSON string)

Reply with a JSON array only, no markdown or extra text. Format:
[{"Subject":"...","Description":"...","Priority":"...","Category":"...","Transcript":"Agent: ...\\n\\nCaller: ...\\n\\nAgent: ..."}, ...]

User prompt or description: ${userPrompt.slice(0, 500)}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text()?.trim() ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const arr = jsonMatch ? parseJsonSafe<Record<string, unknown>[]>(jsonMatch[0]) : [];
    const suggestions = (Array.isArray(arr) ? arr : []).slice(0, 3).map((t) => ({
      Subject: String(t.Subject ?? t.subject ?? "No subject"),
      Description: String(t.Description ?? t.description ?? ""),
      Priority: String(t.Priority ?? t.priority ?? "Medium"),
      Category: String(t.Category ?? t.category ?? "General"),
      Transcript: t.Transcript != null ? String(t.Transcript) : t.transcript != null ? String(t.transcript) : undefined,
    }));
    return { suggestions };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { suggestions: [], error: message };
  }
}
