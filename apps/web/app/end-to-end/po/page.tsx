import E2ePoAnalysis from "../../../components/E2ePoAnalysis";
import E2ePoPicker from "../../../components/E2ePoPicker";

export default async function EndToEndPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  return typeof id === "string" && id ? <E2ePoAnalysis id={id} /> : <E2ePoPicker />;
}
