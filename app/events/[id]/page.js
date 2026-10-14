import { notFound } from "next/navigation";
import OnlineStudio from "@/components/OnlineStudio";

export const metadata = { robots: { index: false, follow: false } };

export default async function EventPage({ params }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <OnlineStudio eventId={id} />;
}
