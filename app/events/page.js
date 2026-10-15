import OnlineStudio from "@/components/OnlineStudio";

export const metadata = { title: "Shared competitions · PixelsDraw" };

export default async function EventsPage({ searchParams }) {
  const query = await searchParams;
  return <OnlineStudio initialHosting={query.host === "1"} />;
}
