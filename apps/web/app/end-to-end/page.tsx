import E2eLinesView from "../../components/E2eLinesView";

export default async function EndToEndPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  return <E2eLinesView initialQuery={query.toString()} />;
}
