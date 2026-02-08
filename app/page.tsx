import {
  getTicketsForQueueWithTranscript,
  loadKnowledgeArticles,
  loadLearningEvents,
  loadKBLineage,
} from "@/lib/excel-parser";
import TrustLoopDashboard from "./components/TrustLoopDashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  const tickets = getTicketsForQueueWithTranscript(5);
  const knowledgeBaseCount = loadKnowledgeArticles().length;
  const learningEventsFromDataset = loadLearningEvents().slice(0, 20);
  const kbLineageFromDataset = loadKBLineage().slice(0, 15);
  return (
    <TrustLoopDashboard
      tickets={tickets}
      initialKnowledgeBaseCount={knowledgeBaseCount}
      learningEventsFromDataset={learningEventsFromDataset}
      kbLineageFromDataset={kbLineageFromDataset}
    />
  );
}
