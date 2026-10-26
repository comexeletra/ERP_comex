import { redirect } from "next/navigation";

/** The model now lives on the first End to End screen, together with the product lines. */
export default function EndToEndModelPage() {
  redirect("/end-to-end");
}
