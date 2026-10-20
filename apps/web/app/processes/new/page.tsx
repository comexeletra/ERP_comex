import NewOperationalRecord from "../../../components/NewOperationalRecord";

export default async function NewProcessPage({ searchParams }: {
  searchParams: Promise<{ from?: string; reviewInvoice?: string }>;
}) {
  const { from, reviewInvoice } = await searchParams;
  const returnHref = from === "catalog" ? "/catalog" : "/processes";
  return <NewOperationalRecord kind="ip" returnHref={returnHref}
    reviewInvoiceId={typeof reviewInvoice === "string" && /^[0-9a-f-]{36}$/iu.test(reviewInvoice) ? reviewInvoice : undefined} />;
}
