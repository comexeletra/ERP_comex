import ProcessWorkspace from "../../../components/ProcessWorkspace";

export default async function ProcessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ return?: string | string[] }> }) {
  const { id } = await params;
  const requested = (await searchParams).return;
  const isProcessList = typeof requested === "string" && (requested === "/processes" || requested.startsWith("/processes?"));
  const isPurchaseOrder = typeof requested === "string" && /^\/purchase-orders\/[0-9a-f-]+(?:\?.*)?$/iu.test(requested);
  const returnPath = typeof requested === "string" && (isProcessList || isPurchaseOrder) ? requested : "/processes";
  return <ProcessWorkspace id={id} returnPath={returnPath} />;
}
