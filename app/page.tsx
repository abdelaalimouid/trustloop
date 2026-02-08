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
  // Serialize to plain objects so Server → Client props are safe (no Date/class instances from xlsx)
  const ticketsPlain = JSON.parse(JSON.stringify(tickets)) as typeof tickets;
  const learningPlain = JSON.parse(JSON.stringify(learningEventsFromDataset));
  const lineagePlain = JSON.parse(JSON.stringify(kbLineageFromDataset));
  return (
    <TrustLoopDashboard
      tickets={ticketsPlain}
      initialKnowledgeBaseCount={knowledgeBaseCount}
      learningEventsFromDataset={learningPlain}
      kbLineageFromDataset={lineagePlain}
    />
  );
}
