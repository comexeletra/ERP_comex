import NewOperationalRecord from "../../../components/NewOperationalRecord";

export default async function NewProcessPage({ searchParams }: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const returnHref = from === "catalog" ? "/catalog" : "/processes";
  return <NewOperationalRecord kind="ip" returnHref={returnHref} />;
}
