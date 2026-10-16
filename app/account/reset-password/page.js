import ResetPasswordPage from "@/components/ResetPasswordPage";
import { Suspense } from "react";

export const metadata = { title: "Reset password · PixelsDraw", robots: { index: false, follow: false } };
export default function Page() { return <main id="main-content"><Suspense fallback={<p role="status">Opening password settings…</p>}><ResetPasswordPage /></Suspense></main>; }
