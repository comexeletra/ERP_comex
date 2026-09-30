import ProcessWorkspace from "../../../components/ProcessWorkspace";

export default async function ProcessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ return?: string | string[] }> }) {
  const { id } = await params;
  const requested = (await searchParams).return;
  const returnPath = typeof requested === "string" && (requested === "/processes" || requested.startsWith("/processes?")) ? requested : "/processes";
  return <ProcessWorkspace id={id} returnPath={returnPath} />;
}
