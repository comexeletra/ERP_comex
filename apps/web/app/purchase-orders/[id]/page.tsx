import PurchaseOrderWorkspace from "../../../components/PurchaseOrderWorkspace";

export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ return?: string | string[] }> }) {
  const { id } = await params;
  const requestedReturn = (await searchParams).return;
  const returnPath = typeof requestedReturn === "string" && (requestedReturn === "/" || requestedReturn.startsWith("/?")) ? requestedReturn : "/";
  return <PurchaseOrderWorkspace id={id} returnPath={returnPath} />;
}
