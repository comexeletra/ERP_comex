import ProductLinesView from "../../../components/ProductLinesView";

export default async function ProductLinesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  return <ProductLinesView initialQuery={query.toString()} />;
}
