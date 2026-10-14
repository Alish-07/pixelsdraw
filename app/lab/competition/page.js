import { notFound } from "next/navigation";
import CompetitionPreview from "@/components/CompetitionPreview";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CompetitionPreview />;
}
