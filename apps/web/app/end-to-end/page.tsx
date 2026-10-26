import E2eFlowDemo from "../../components/E2eFlowDemo";
import E2ePoAnalysis from "../../components/E2ePoAnalysis";

export default async function EndToEndPage({ searchParams }: { searchParams: Promise<{ po?: string | string[] }> }) {
  const { po } = await searchParams;
  return typeof po === "string" && po ? <E2ePoAnalysis id={po} /> : <E2eFlowDemo />;
}
