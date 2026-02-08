"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  ShieldCheck,
  AlertCircle,
  Play,
  Square,
  Copy,
  Check,
  Sparkles,
  BookOpen,
  Quote,
  Cpu,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { analyzeTicket, type AnalyzeTicketResult, type KnowledgeSource } from "@/app/actions/analyzeTicket";
import { suggestTickets, type SuggestedTicket } from "@/app/actions/suggestTickets";
import type { TicketRow } from "@/lib/excel-parser";

type TicketWithTranscript = TicketRow & { transcript?: string };
const STORAGE_KEY = "trustloop_self_learning";

type PublishedArticle = {
  id: string;
  title: string;
  body: string;
  publishedAt: number;
  ticketId: string;
};
type LearningEvent = {
  type: "gap_detected" | "draft_proposed" | "approved";
  ticketId: string;
  kbId?: string;
  label: string;
  ts: number;
};

type SessionLineageRow = { KB_Article_ID: string; Source_Type: string; Source_ID: string; Evidence_Snippet?: string };

function loadPersistedState(): { published: PublishedArticle[]; learning: LearningEvent[]; lineage: SessionLineageRow[] } {
  if (typeof window === "undefined") return { published: [], learning: [], lineage: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { published: [], learning: [], lineage: [] };
    const data = JSON.parse(raw) as { published?: PublishedArticle[]; learning?: LearningEvent[]; lineage?: SessionLineageRow[] };
    return {
      published: Array.isArray(data.published) ? data.published : [],
      learning: Array.isArray(data.learning) ? data.learning : [],
      lineage: Array.isArray(data.lineage) ? data.lineage : [],
    };
  } catch {
    return { published: [], learning: [], lineage: [] };
  }
}

function savePersistedState(published: PublishedArticle[], learning: LearningEvent[], lineage: SessionLineageRow[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ published, learning, lineage }));
  } catch {
    /* ignore */
  }
}

const PROCESSING_STEPS = [
  { id: "1", label: "Searching KB & learned articles" },
  { id: "2", label: "Building RAG context" },
  { id: "3", label: "Generating solution (Gemini)" },
  { id: "4", label: "Checking compliance" },
];

type DatasetLearningEvent = { Event_ID?: string; Trigger_Ticket_Number?: string; Proposed_KB_Article_ID?: string; Draft_Summary?: string; Final_Status?: string };
type DatasetKBLineage = { KB_Article_ID?: string; Source_Type?: string; Source_ID?: string; Evidence_Snippet?: string };

export default function TrustLoopDashboard({
  tickets,
  initialKnowledgeBaseCount = 0,
  learningEventsFromDataset = [],
  kbLineageFromDataset = [],
}: {
  tickets: TicketWithTranscript[];
  initialKnowledgeBaseCount?: number;
  learningEventsFromDataset?: DatasetLearningEvent[];
  kbLineageFromDataset?: DatasetKBLineage[];
}) {
  const [selectedTicket, setSelectedTicket] = useState<TicketWithTranscript | null>(
    tickets[0] ?? null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [transcriptVisibleLength, setTranscriptVisibleLength] = useState(0);
  const [transcriptFull, setTranscriptFull] = useState("");
  const [analysis, setAnalysis] = useState<AnalyzeTicketResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [newKnowledgeDraft, setNewKnowledgeDraft] = useState<string | null>(null);
  const [publishedArticles, setPublishedArticles] = useState<PublishedArticle[]>([]);
  const [learningLog, setLearningLog] = useState<LearningEvent[]>([]);
  const [sessionLineage, setSessionLineage] = useState<SessionLineageRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [justPublishedId, setJustPublishedId] = useState<string | null>(null);
  const [processingSteps, setProcessingSteps] = useState<{ id: string; label: string; status: "pending" | "active" | "done" }[]>([]);
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [showAgentLog, setShowAgentLog] = useState(false);
  const [customTickets, setCustomTickets] = useState<TicketWithTranscript[]>([]);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [createTicketPrompt, setCreateTicketPrompt] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestedTicket[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [usageCount, setUsageCount] = useState<Record<string, number>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<{ total: number; gaps: number; fromKb: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stepsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPlayedTranscriptRef = useRef<string>("");

  // Hydrate from localStorage so self-learning persists across refresh (per RealPage doc)
  useEffect(() => {
    const { published, learning, lineage } = loadPersistedState();
    /* eslint-disable react-hooks/set-state-in-effect -- hydration from localStorage */
    setPublishedArticles(published);
    setLearningLog(learning);
    setSessionLineage(lineage);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (publishedArticles.length === 0 && learningLog.length === 0 && sessionLineage.length === 0) return;
    savePersistedState(publishedArticles, learningLog, sessionLineage);
  }, [publishedArticles, learningLog, sessionLineage]);

  useEffect(() => {
    if (selectedTicket) {
      const t = selectedTicket as TicketWithTranscript;
      lastPlayedTranscriptRef.current = t.transcript || selectedTicket.Description || selectedTicket.Subject || "";
    } else {
      lastPlayedTranscriptRef.current = "";
    }
  }, [selectedTicket]);

  const displayTranscript = selectedTicket
    ? (selectedTicket as TicketWithTranscript).transcript ||
      selectedTicket.Description ||
      selectedTicket.Subject ||
      ""
    : "";

  const displaySummary = (t: TicketRow) =>
    t.Subject || (t.Description ?? "").slice(0, 60) + (t.Description && t.Description.length > 60 ? "…" : "");

  const runTranscriptSimulation = useCallback((fullText: string, durationMs: number) => {
    const words = fullText.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    lastPlayedTranscriptRef.current = fullText;
    const interval = Math.max(80, durationMs / words.length);
    let idx = 0;
    setTranscriptVisibleLength(0);
    setTranscriptFull(fullText);
    transcriptIntervalRef.current = setInterval(() => {
      idx += 1;
      setTranscriptVisibleLength(idx);
      if (idx >= words.length && transcriptIntervalRef.current) {
        clearInterval(transcriptIntervalRef.current);
        transcriptIntervalRef.current = null;
      }
    }, interval);
  }, []);

  const stopCall = useCallback(() => {
    if (transcriptIntervalRef.current) {
      clearInterval(transcriptIntervalRef.current);
      transcriptIntervalRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  }, []);

  const onCallEnd = useCallback(async () => {
    if (!selectedTicket) return;
    const ticketId = String(selectedTicket.Ticket_Number);
    setAnalyzing(true);
    setProcessingSteps(PROCESSING_STEPS.map((s) => ({ ...s, status: "pending" as const })));
    setAgentLog([`[${new Date().toISOString().slice(11, 19)}] Call ended · Analyzing ${ticketId}`]);
    const transcript =
      lastPlayedTranscriptRef.current ||
      (selectedTicket as TicketWithTranscript).transcript ||
      selectedTicket.Description ||
      selectedTicket.Subject ||
      "";
    const learned = publishedArticles.map((a) => ({ id: a.id, title: a.title, body: a.body, ticketId: a.ticketId }));
    const result = await analyzeTicket(ticketId, transcript, learned);
    setProcessingSteps(PROCESSING_STEPS.map((s) => ({ ...s, status: "done" as const })));
    setAgentLog((prev) => [...prev, `[${new Date().toISOString().slice(11, 19)}] Done · ${(result.sources_used ?? []).length} sources`]);
    setAnalysis(result);
    if (result.sources_used?.length) {
      setUsageCount((prev) => {
        const next = { ...prev };
        (result.sources_used as KnowledgeSource[]).forEach((s) => {
          next[s.id] = (next[s.id] ?? 0) + 1;
        });
        return next;
      });
    }
    if (result.new_knowledge_draft) {
      setNewKnowledgeDraft(result.new_knowledge_draft);
      setLearningLog((prev) => [
        ...prev,
        { type: "gap_detected", ticketId, label: "Knowledge gap detected", ts: Date.now() },
        { type: "draft_proposed", ticketId, label: "Draft article proposed", ts: Date.now() },
      ]);
    }
    setAnalyzing(false);
  }, [selectedTicket, publishedArticles, setNewKnowledgeDraft, setLearningLog, setAnalysis, setProcessingSteps, setAgentLog, setUsageCount, setAnalyzing]);

  const playCall = useCallback(async () => {
    if (!selectedTicket) return;
    stopCall();
    const text =
      (selectedTicket as TicketWithTranscript).transcript ||
      selectedTicket.Description ||
      selectedTicket.Subject ||
      "No description available.";
    const truncated = text.slice(0, 2500);

    setAnalysis(null);
    setNewKnowledgeDraft(null);
    setTranscriptFull("");
    setTranscriptVisibleLength(0);

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: truncated }),
      });
      if (!res.ok) {
        runTranscriptSimulation(text, 8000);
        setIsPlaying(true);
        setTimeout(() => {
          setIsPlaying(false);
          onCallEnd();
        }, 8000);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      const durationMs = 60000;
      runTranscriptSimulation(truncated, durationMs);
      setIsPlaying(true);
      audio.playbackRate = 1.2;
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
        onCallEnd();
      };
      audio.play();
    } catch {
      runTranscriptSimulation(text, 6000);
      setIsPlaying(true);
      setTimeout(() => {
        setIsPlaying(false);
        onCallEnd();
      }, 6000);
    }
  }, [selectedTicket, runTranscriptSimulation, stopCall, onCallEnd, setAnalysis, setNewKnowledgeDraft, setTranscriptFull, setTranscriptVisibleLength]);

  useEffect(() => {
    return () => {
      if (transcriptIntervalRef.current) clearInterval(transcriptIntervalRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleApprovePublish = useCallback(() => {
    if (!newKnowledgeDraft || !selectedTicket) return;
    const ticketId = String(selectedTicket.Ticket_Number);
    const titleMatch = newKnowledgeDraft.match(/Title:\s*(.+?)(?:\n|$)/i);
    const bodyMatch = newKnowledgeDraft.match(/Body:\s*([\s\S]*)/i);
    const title = titleMatch ? titleMatch[1].trim() : "New knowledge article";
    const bodyFull = bodyMatch ? bodyMatch[1].trim() : newKnowledgeDraft;
    const kbId = `KB-${Date.now()}`;
    setPublishedArticles((prev) => [
      ...prev,
      {
        id: kbId,
        title,
        body: bodyFull,
        publishedAt: Date.now(),
        ticketId,
      },
    ]);
    setLearningLog((prev) => [
      ...prev,
      { type: "approved", ticketId, kbId, label: "Article approved & published", ts: Date.now() },
    ]);
    // Persist lineage in same shape as KB_Lineage (doc alignment)
    setSessionLineage((prev) => [
      ...prev,
      { KB_Article_ID: kbId, Source_Type: "Ticket", Source_ID: ticketId, Evidence_Snippet: bodyFull.slice(0, 200) },
    ]);
    setNewKnowledgeDraft(null);
    setJustPublishedId(kbId);
    setTimeout(() => setJustPublishedId(null), 3000);
  }, [newKnowledgeDraft, selectedTicket, setPublishedArticles, setLearningLog, setSessionLineage, setNewKnowledgeDraft, setJustPublishedId]);

  const copySolution = useCallback(() => {
    if (!analysis?.solution) return;
    navigator.clipboard.writeText(analysis.solution);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [analysis]);

  const visibleTranscript = transcriptFull
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, transcriptVisibleLength)
    .join(" ");

  const runAnalyzeNow = useCallback(async () => {
    if (!selectedTicket) return;
    const ticketId = String(selectedTicket.Ticket_Number);
    setAnalyzing(true);
    setAnalysis(null);
    setNewKnowledgeDraft(null);
    setProcessingSteps(PROCESSING_STEPS.map((s) => ({ ...s, status: "pending" as const })));
    setAgentLog([`[${new Date().toISOString().slice(11, 19)}] Starting analysis for ${ticketId}`]);
    const transcript =
      lastPlayedTranscriptRef.current ||
      (selectedTicket as TicketWithTranscript).transcript ||
      selectedTicket.Description ||
      selectedTicket.Subject ||
      "";
    const learned = publishedArticles.map((a) => ({ id: a.id, title: a.title, body: a.body, ticketId: a.ticketId }));
    let stepIdx = 0;
    stepsTimerRef.current = setInterval(() => {
      stepIdx += 1;
      if (stepIdx <= PROCESSING_STEPS.length) {
        setProcessingSteps((prev) =>
          prev.map((s, i) => ({
            ...s,
            status: i < stepIdx ? "done" : i === stepIdx ? "active" : "pending",
          }))
        );
        setAgentLog((prev) => [...prev, `[${new Date().toISOString().slice(11, 19)}] ${PROCESSING_STEPS[stepIdx - 1]?.label ?? "Done"}`]);
      }
    }, 600);
    const result = await analyzeTicket(ticketId, transcript, learned);
    if (stepsTimerRef.current) {
      clearInterval(stepsTimerRef.current);
      stepsTimerRef.current = null;
    }
    setProcessingSteps(PROCESSING_STEPS.map((s) => ({ ...s, status: "done" as const })));
    setAgentLog((prev) => [
      ...prev,
      `[${new Date().toISOString().slice(11, 19)}] RAG sources: ${(result.sources_used ?? []).length} articles`,
      `[${new Date().toISOString().slice(11, 19)}] Confidence: ${((result.confidence_score ?? 0) * 100).toFixed(0)}% · Compliance: ${result.compliance_status}`,
    ]);
    setAnalysis(result);
    if (result.sources_used?.length) {
      setUsageCount((prev) => {
        const next = { ...prev };
        (result.sources_used as KnowledgeSource[]).forEach((s) => {
          next[s.id] = (next[s.id] ?? 0) + 1;
        });
        return next;
      });
    }
    if (result.new_knowledge_draft) {
      setNewKnowledgeDraft(result.new_knowledge_draft);
      setLearningLog((prev) => [
        ...prev,
        { type: "gap_detected", ticketId, label: "Knowledge gap detected", ts: Date.now() },
        { type: "draft_proposed", ticketId, label: "Draft article proposed", ts: Date.now() },
      ]);
    }
    setAnalyzing(false);
  }, [selectedTicket, publishedArticles, setAnalyzing, setAnalysis, setNewKnowledgeDraft, setProcessingSteps, setAgentLog, setUsageCount, setLearningLog]);

  const getPriorityStyle = (priority: string | undefined) => {
    const p = (priority ?? "").toLowerCase();
    if (p === "critical") return "bg-rose-500/25 text-rose-300 border-rose-500/40";
    if (p === "high") return "bg-amber-500/25 text-amber-300 border-amber-500/40";
    if (p === "medium") return "bg-slate-500/25 text-slate-300 border-slate-500/40";
    return "bg-zinc-600/30 text-zinc-400 border-zinc-600/50";
  };

  const formatTranscriptForDisplay = (raw: string) => {
    const lines = raw.split(/\n/).filter(Boolean);
    return lines.map((line, i) => {
      const isAgent = /\(ExampleCo\)|Alex|Agent:/i.test(line);
      return (
        <p
          key={i}
          className={cn(
            "text-sm leading-relaxed",
            isAgent ? "text-emerald-300/90" : "text-zinc-300"
          )}
        >
          {line}
        </p>
      );
    });
  };

  const currentStep = analysis ? (newKnowledgeDraft ? 3 : 2) : selectedTicket ? 2 : 1;

  const allTickets = useMemo<TicketWithTranscript[]>(
    () => [...customTickets, ...tickets],
    [customTickets, tickets]
  );

  const recurringThemes = useMemo(() => {
    const m: Record<string, number> = {};
    allTickets.forEach((t) => {
      const c = (t as TicketWithTranscript).Category || "Uncategorized";
      m[c] = (m[c] ?? 0) + 1;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [allTickets]);

  const runBatchSimulation = useCallback(async () => {
    const toRun = allTickets.slice(0, 3);
    if (toRun.length === 0) return;
    setBatchRunning(true);
    setBatchResult(null);
    const learned = publishedArticles.map((a) => ({ id: a.id, title: a.title, body: a.body, ticketId: a.ticketId }));
    let gaps = 0;
    let fromKb = 0;
    for (const t of toRun) {
      const transcript = (t as TicketWithTranscript).transcript || t.Description || t.Subject || "";
      const res = await analyzeTicket(String(t.Ticket_Number), transcript, learned);
      if (res.new_knowledge_draft) gaps += 1;
      else fromKb += 1;
    }
    setBatchResult({ total: toRun.length, gaps, fromKb });
    setBatchRunning(false);
  }, [allTickets, publishedArticles]);

  const handleSuggestTickets = useCallback(async () => {
    setSuggesting(true);
    setSuggestions([]);
    const { suggestions: s, error } = await suggestTickets(createTicketPrompt || "Generate 3 realistic support tickets for property management software.");
    setSuggesting(false);
    if (error) setAgentLog((prev) => [...prev, `[Suggest] Error: ${error}`]);
    else setSuggestions(s ?? []);
  }, [createTicketPrompt]);

  const handleUseSuggestion = useCallback(
    (s: SuggestedTicket) => {
      const id = `CUSTOM-${Date.now()}`;
      const newT: TicketWithTranscript = {
        Ticket_Number: id,
        Subject: s.Subject,
        Description: s.Description,
        Priority: s.Priority,
        Category: s.Category,
        transcript: s.Transcript ?? undefined,
      };
      setCustomTickets((prev) => [newT, ...prev]);
      setSelectedTicket(newT);
      setSuggestions([]);
      setCreateTicketOpen(false);
    },
    []
  );

  const triggerPublishWithCelebration = useCallback(() => {
    handleApprovePublish();
    setShowCelebration(true);
    setTimeout(() => setShowCelebration(false), 2000);
  }, [handleApprovePublish]);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900/95 to-emerald-950/30 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                TrustLoop
              </h1>
              <p className="text-xs text-zinc-400">
                Self-Learning Support Intelligence · RealPage Challenge
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-1.5 sm:flex">
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", currentStep >= 1 ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500")}>1. Select</span>
            <span className="text-zinc-600">→</span>
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", currentStep >= 2 ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500")}>2. Analyze</span>
            <span className="text-zinc-600">→</span>
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", currentStep >= 3 ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500")}>3. Publish</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Column 1: Queue — 25% */}
        <aside className="flex w-[25%] min-w-[240px] flex-col border-r border-zinc-800 bg-zinc-900/50">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <FileText className="h-4 w-4 text-zinc-500" />
              Ticket Queue
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">
              From dataset. Per brief: add more synthetic data as needed.
            </p>
          </div>
          <div className="border-b border-zinc-800 p-2">
            <button
              type="button"
              onClick={() => setCreateTicketOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-zinc-600 bg-zinc-800/30 px-3 py-2 text-left text-xs font-medium text-zinc-400 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-400"
            >
              <span className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4" />
                Create new ticket
              </span>
              {createTicketOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {createTicketOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-2 space-y-2"
              >
                <textarea
                  value={createTicketPrompt}
                  onChange={(e) => setCreateTicketPrompt(e.target.value)}
                  placeholder="Describe the issue or leave blank for AI suggestions..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500"
                  rows={2}
                />
                <button
                  type="button"
                  onClick={handleSuggestTickets}
                  disabled={suggesting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
                >
                  <Zap className="h-4 w-4" />
                  {suggesting ? "Generating…" : "Suggest with AI (Gemini)"}
                </button>
                {suggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-zinc-500">Use one:</p>
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleUseSuggestion(s)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-left text-xs text-zinc-300 hover:border-emerald-500/50 hover:bg-emerald-500/10"
                      >
                        <span className="font-medium">{s.Subject}</span>
                        <span className="ml-1 text-zinc-500">· {s.Priority}</span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </div>
          {recurringThemes.length > 0 && (
            <div className="border-b border-zinc-800 p-2">
              <p className="mb-1.5 text-[10px] font-medium text-zinc-500">Recurring themes</p>
              <div className="flex flex-wrap gap-1">
                {recurringThemes.map(([cat, count]) => (
                  <span
                    key={cat}
                    className="rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-400"
                  >
                    {cat} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="border-b border-zinc-800 p-2">
            <button
              type="button"
              onClick={runBatchSimulation}
              disabled={batchRunning || allTickets.length === 0}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700/50 disabled:opacity-50"
            >
              {batchRunning ? "Running batch…" : "Simulate batch (3 tickets)"}
            </button>
            {batchResult && (
              <p className="mt-1.5 text-[10px] text-zinc-500">
                {batchResult.total} analyzed · {batchResult.gaps} gap(s) · {batchResult.fromKb} from KB
              </p>
            )}
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
            {allTickets.map((t) => (
              <li key={String(t.Ticket_Number)}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTicket(t);
                    setAnalysis(null);
                    setNewKnowledgeDraft(null);
                    setProcessingSteps([]);
                    stopCall();
                  }}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition",
                    selectedTicket?.Ticket_Number === t.Ticket_Number
                      ? "border-emerald-500/50 bg-emerald-500/10 text-white"
                      : "border-zinc-800 bg-zinc-800/30 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-zinc-500">
                      {String(t.Ticket_Number)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
                        getPriorityStyle(t.Priority)
                      )}
                    >
                      {t.Priority ?? "Normal"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-200">
                    {displaySummary(t)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Column 2: Action Center — 50% */}
        <main className="flex min-w-0 flex-1 flex-col border-r border-zinc-800 bg-zinc-950">
          <div className="border-b border-zinc-800 px-6 py-4">
            <h2 className="text-base font-semibold text-white">
              Live Interaction
            </h2>
            <p className="text-xs text-zinc-500">
              {selectedTicket
                ? `${selectedTicket.Ticket_Number} · ${selectedTicket.Category ?? "—"}${(selectedTicket as TicketWithTranscript).transcript ? " · From conversation" : ""}`
                : "Select a ticket"}
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            {/* Conversation + Analyze */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 shadow-lg shadow-black/20">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runAnalyzeNow}
                  disabled={!selectedTicket || analyzing}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-5 py-3 font-semibold transition shadow-lg",
                    analyzing
                      ? "cursor-wait bg-amber-500/30 text-amber-300"
                      : "bg-emerald-500 text-white hover:bg-emerald-400 shadow-emerald-500/25"
                  )}
                >
                  <Sparkles className="h-5 w-5" />
                  {analyzing ? "Analyzing…" : "Analyze now"}
                </button>
                <span className="text-xs text-zinc-500">or</span>
                <button
                  type="button"
                  title="Simulated call: transcript → speech (per doc)"
                  onClick={isPlaying ? stopCall : playCall}
                  disabled={!selectedTicket || analyzing}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-4 py-2.5 font-medium transition",
                    isPlaying
                      ? "border-rose-500/50 bg-rose-500/20 text-rose-400"
                      : "border-zinc-600 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-700/50"
                  )}
                >
                  {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? "End call" : "Play call"}
                </button>
                <span className="text-[10px] text-zinc-500" title="Per doc: Support Transcripts / Speech-to-Text">
                  Simulated call (transcript → speech)
                </span>
              </div>
              {(analyzing || processingSteps.some((s) => s.status !== "pending")) && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-400/90">
                    <Cpu className="h-3.5 w-3.5" />
                    Thought process
                  </h4>
                  <ul className="space-y-1.5">
                    {processingSteps.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                            s.status === "done" && "bg-emerald-500/30 text-emerald-400",
                            s.status === "active" && "bg-amber-500/30 text-amber-400 animate-pulse",
                            s.status === "pending" && "bg-zinc-700 text-zinc-500"
                          )}
                        >
                          {s.status === "done" ? "✓" : s.status === "active" ? "..." : "○"}
                        </span>
                        <span className={cn(s.status === "pending" && "text-zinc-500")}>{s.label}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
              <div className="mt-4 min-h-[120px] rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
                {isPlaying ? (
                  <p className="text-sm leading-relaxed text-zinc-400">{visibleTranscript}</p>
                ) : displayTranscript ? (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {formatTranscriptForDisplay(displayTranscript)}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">
                    Select a ticket to see the conversation. Use <strong className="text-zinc-400">Analyze now</strong> to get the AI solution, or <strong className="text-zinc-400">Play call</strong> to simulate the call first.
                  </p>
                )}
              </div>
            </div>

            {/* AI Solution */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 shadow-lg shadow-black/20">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Sparkles className="h-4 w-4 text-amber-400" />
                AI Suggested Response
              </h3>
              {analysis ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div className="relative h-8 w-8">
                          <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-zinc-800"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <motion.path
                              className={cn(
                                analysis.confidence_score >= 0.8 ? "text-emerald-500" : analysis.confidence_score >= 0.5 ? "text-amber-500" : "text-rose-500"
                              )}
                              stroke="currentColor"
                              strokeWidth="2.5"
                              fill="none"
                              strokeLinecap="round"
                              strokeDasharray="100"
                              initial={{ strokeDashoffset: 100 }}
                              animate={{ strokeDashoffset: 100 - analysis.confidence_score * 100 }}
                              transition={{ duration: 0.8, ease: "easeOut" }}
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-zinc-200">
                            {(analysis.confidence_score * 100).toFixed(0)}
                          </span>
                        </div>
                        <span className="text-xs text-zinc-500">Confidence</span>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        analysis.compliance_status === "SAFE"
                          ? "text-emerald-400"
                          : analysis.compliance_status === "UNSAFE"
                            ? "text-rose-400"
                            : "text-zinc-500"
                      )}
                    >
                      {analysis.compliance_status === "SAFE"
                        ? "Compliance: Passed"
                        : analysis.compliance_status === "UNSAFE"
                          ? "Compliance: Blocked"
                          : "Compliance: —"}
                    </span>
                    <button
                      type="button"
                      onClick={copySolution}
                      className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-sm text-zinc-300 whitespace-pre-wrap">
                    {analysis.solution}
                  </div>
                  {analysis.recommended_resource && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2">
                      <p className="text-[10px] text-amber-400/90 font-medium">Best resource (per doc: KB vs script)</p>
                      <p className="mt-0.5 font-mono text-xs text-amber-200">
                        {analysis.recommended_resource.type} → {analysis.recommended_resource.id}
                        {analysis.recommended_resource.title ? ` · ${analysis.recommended_resource.title}` : ""}
                      </p>
                    </div>
                  )}
                  {analysis.qa_score != null && (
                    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-1.5">
                      <span className="text-[10px] text-zinc-500">QA score (rubric)</span>
                      <span className={cn(
                        "font-bold tabular-nums",
                        analysis.qa_score >= 80 ? "text-emerald-400" : analysis.qa_score >= 60 ? "text-amber-400" : "text-rose-400"
                      )}>
                        {analysis.qa_score}%
                      </span>
                    </div>
                  )}
                  {analysis.red_flags && analysis.red_flags.length > 0 && (
                    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2">
                      <p className="text-[10px] font-medium text-rose-400">Red flags (autozero)</p>
                      <ul className="mt-0.5 list-inside list-disc text-xs text-rose-300/90">
                        {analysis.red_flags.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis.coaching_tip && (
                    <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-2">
                      <p className="text-[10px] font-medium text-sky-400/90">AI Coaching</p>
                      <p className="mt-0.5 text-xs text-sky-200/90">{analysis.coaching_tip}</p>
                    </div>
                  )}
                  {analysis.sources_used && analysis.sources_used.length > 0 && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-400/90">
                        <Quote className="h-3.5 w-3.5" />
                        Knowledge found here
                      </h4>
                      <ul className="space-y-2">
                        {(analysis.sources_used as KnowledgeSource[]).slice(0, 4).map((src, i) => (
                          <li key={`${src.id}-${i}`} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px] text-emerald-400/80">{src.id}</span>
                              {src.source === "learned" && src.ticketId && (
                                <span className="text-[10px] text-zinc-500">from {src.ticketId}</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs font-medium text-zinc-200">{src.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">&ldquo;{src.snippet}…&rdquo;</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAgentLog((b) => !b)}
                    className="flex items-center gap-2 text-[10px] text-zinc-500 hover:text-zinc-400"
                  >
                    <Cpu className="h-3 w-3" />
                    {showAgentLog ? "Hide" : "Show"} technical log
                  </button>
                  {showAgentLog && agentLog.length > 0 && (
                    <pre className="max-h-24 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-500">
                      {agentLog.join("\n")}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 p-4 text-center">
                  <p className="text-sm text-zinc-500">
                    Click <strong className="text-emerald-400">Analyze now</strong> above to get the AI solution for this ticket. No need to play the call.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Column 3: Trust Loop — 25% */}
        <aside className="flex w-[25%] min-w-[280px] flex-col bg-zinc-900/50">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <ShieldCheck className="h-4 w-4 text-zinc-500" />
              Knowledge Governance
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">
              Self-learning: persisted across refresh (lineage per doc).
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* KB count — animate when it grows */}
            <motion.div
              key={initialKnowledgeBaseCount + publishedArticles.length}
              initial={publishedArticles.length > 0 ? { scale: 1.1 } : false}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4 }}
              className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 shadow-inner"
            >
              <p className="text-xs text-zinc-500">
                Knowledge base:{" "}
                <span className="text-lg font-bold tabular-nums text-white">
                  {initialKnowledgeBaseCount + publishedArticles.length}
                </span>
                {publishedArticles.length > 0 && (
                  <span className="ml-2 text-sm font-medium text-emerald-400">
                    +{publishedArticles.length} learned this session
                  </span>
                )}
              </p>
            </motion.div>

            {/* Learning activity timeline — always visible */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-400">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Learning activity
              </h3>
              {learningLog.length > 0 ? (
                <ul className="space-y-2">
                  {learningLog.slice(-8).reverse().map((ev, i) => (
                    <motion.li
                      key={`${ev.ts}-${i}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded-md border px-2 py-0.5 font-medium",
                          ev.type === "approved"
                            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                            : "border-amber-500/40 bg-amber-500/20 text-amber-400"
                        )}
                      >
                        {ev.type === "approved" ? "Published" : "Gap"}
                      </span>
                      <span className="text-zinc-400">{ev.label}</span>
                      <span className="font-mono text-zinc-500">{ev.ticketId}</span>
                      {ev.kbId && (
                        <span className="font-mono text-emerald-500/90">→ {ev.kbId}</span>
                      )}
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-600">
                  When the AI detects a knowledge gap and you publish, events appear here — so you see the self-learning loop in action.
                </p>
              )}
            </div>

            {/* Historical learning events from dataset (doc alignment) */}
            {learningEventsFromDataset.length > 0 && (
              <details className="rounded-xl border border-zinc-800 bg-zinc-950/30">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-400">
                  Historical learning events (dataset) — {learningEventsFromDataset.length} rows
                </summary>
                <ul className="max-h-32 space-y-1 overflow-y-auto border-t border-zinc-800 px-3 py-2">
                  {learningEventsFromDataset.slice(0, 8).map((ev, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2 text-[10px] text-zinc-500">
                      <span className="font-mono">{ev.Trigger_Ticket_Number ?? "—"}</span>
                      <span>→</span>
                      <span className="font-mono text-emerald-500/80">{ev.Proposed_KB_Article_ID ?? "—"}</span>
                      <span className="text-zinc-600">{ev.Final_Status ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* KB lineage from dataset (doc alignment) */}
            {kbLineageFromDataset.length > 0 && (
              <details className="rounded-xl border border-zinc-800 bg-zinc-950/30">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-400">
                  Lineage (dataset) — {kbLineageFromDataset.length} rows
                </summary>
                <ul className="max-h-32 space-y-1 overflow-y-auto border-t border-zinc-800 px-3 py-2">
                  {kbLineageFromDataset.slice(0, 6).map((row, i) => (
                    <li key={i} className="text-[10px] text-zinc-500">
                      <span className="font-mono text-emerald-500/80">{row.KB_Article_ID ?? "—"}</span>
                      <span className="mx-1">←</span>
                      <span className="font-mono">{row.Source_Type ?? "—"}</span> {row.Source_ID ?? ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Session lineage (persisted in same shape as KB_Lineage) */}
            {sessionLineage.length > 0 && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2">
                <h3 className="mb-1.5 text-xs font-medium text-emerald-400/90">Session lineage</h3>
                <ul className="space-y-1">
                  {sessionLineage.slice(-6).reverse().map((row, i) => (
                    <li key={i} className="text-[10px] text-zinc-400">
                      <span className="font-mono text-emerald-400/90">{row.KB_Article_ID}</span>
                      <span className="mx-1">←</span>
                      <span className="font-mono">{row.Source_Type}</span> {row.Source_ID}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <AnimatePresence mode="wait">
              {newKnowledgeDraft ? (
                <motion.div
                  key="new-insight"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      New Insight Detected
                    </span>
                  </div>
                  {(analysis && (analysis.confidence_score < 0.7 || (analysis.qa_score != null && analysis.qa_score < 60))) && (
                    <div className="mb-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <strong>Review before publishing:</strong> Low confidence ({Math.round(analysis.confidence_score * 100)}%) or low QA score ({analysis.qa_score ?? "—"}%). Verify the draft is correct before adding to the knowledge base.
                    </div>
                  )}
                  <p className="mb-3 max-h-32 overflow-y-auto text-xs text-zinc-400 whitespace-pre-wrap">
                    {newKnowledgeDraft}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={triggerPublishWithCelebration}
                      className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                    >
                      Approve & Publish
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTicket) {
                          setLearningLog((prev) => [
                            ...prev,
                            { type: "gap_detected", ticketId: String(selectedTicket.Ticket_Number), label: "Draft dismissed (not published)", ts: Date.now() },
                          ]);
                        }
                        setNewKnowledgeDraft(null);
                      }}
                      className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                    >
                      Dismiss draft
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="no-draft"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl border border-dashed border-zinc-700 bg-zinc-800/20 p-4"
                >
                  <p className="text-xs text-zinc-500">
                    When the AI infers a solution <strong className="text-zinc-400">not</strong> in the knowledge base, a draft article will appear here. Click <strong className="text-zinc-400">Approve & Publish</strong> to add it — that’s the self-learning loop.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
                <BookOpen className="h-3.5 w-3.5" />
                Live Knowledge Base
              </h3>
              <ul className="space-y-2">
                {publishedArticles.map((a) => (
                  <motion.li
                    key={a.id}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: justPublishedId === a.id ? 1.02 : 1,
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className={cn(
                      "rounded-xl border bg-emerald-500/10 p-3 transition-shadow",
                      justPublishedId === a.id
                        ? "border-emerald-400/60 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-500/30"
                        : "border-emerald-500/30"
                    )}
                  >
                    {justPublishedId === a.id && (
                      <motion.span
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-2 inline-block rounded-full bg-emerald-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300"
                      >
                        Just published
                      </motion.span>
                    )}
                    <p className="font-mono text-[10px] text-emerald-400/80">
                      {a.id}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-zinc-200">
                      {a.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                      {a.body.length > 300 ? `${a.body.slice(0, 300)}…` : a.body}
                    </p>
                    <p className="mt-2 border-t border-zinc-800/80 pt-2 text-[10px] text-zinc-500">
                      Provenance: from Ticket {a.ticketId}
                      {(usageCount[a.id] ?? 0) > 0 && (
                        <span className="ml-2 text-emerald-500/80">· Cited in {usageCount[a.id]} analyses</span>
                      )}
                    </p>
                  </motion.li>
                ))}
                {publishedArticles.length === 0 && (
                  <li className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-600">
                    Approved articles will appear here.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="rounded-2xl border-2 border-emerald-400 bg-emerald-500/20 px-8 py-4 shadow-2xl shadow-emerald-500/30 backdrop-blur"
            >
              <p className="text-center text-2xl font-bold text-emerald-300">Knowledge published</p>
              <p className="mt-1 text-center text-sm text-emerald-400/80">The system just learned something new.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
