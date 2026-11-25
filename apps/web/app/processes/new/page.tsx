import NewOperationalRecord from "../../../components/NewOperationalRecord";

export default async function NewProcessPage({ searchParams }: {
  searchParams: Promise<{ reviewInvoice?: string }>;
}) {
  const { reviewInvoice } = await searchParams;
  return <NewOperationalRecord kind="ip" returnHref="/processes"
    reviewInvoiceId={typeof reviewInvoice === "string" && /^[0-9a-f-]{36}$/iu.test(reviewInvoice) ? reviewInvoice : undefined} />;
}
