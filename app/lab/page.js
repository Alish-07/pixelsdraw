import Link from "next/link";
import { notFound } from "next/navigation";
import ExperimentalPixelCanvas from "@/components/ExperimentalPixelCanvas";

export default function EditorLab() {
  // Keep the lab route local-only; the main site now uses the same editor.
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="pixel-workspace editor-lab">
    <header className="lab-header"><strong>Pixel Art Studio <span>Local lab</span></strong><Link href="/">Back to current editor</Link></header>
    <ExperimentalPixelCanvas />
  </main>;
}
