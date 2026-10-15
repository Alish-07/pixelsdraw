import Studio from "@/components/Studio";
import { SITE_NAME } from "@/lib/site-config.mjs";

export default function Home() {
  return <main id="main-content" tabIndex={-1} className="studio-page"><h1 className="sr-only">{SITE_NAME}</h1><Studio /></main>;
}
