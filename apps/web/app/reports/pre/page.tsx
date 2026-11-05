import ReportsView from "../../../components/ReportsView";

export default async function PreShipmentReportsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The dashboard filters come from the URL, so a link keeps them; a list repeats its key.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return <ReportsView scope="pre" initialQuery={query.toString()} />;
}
