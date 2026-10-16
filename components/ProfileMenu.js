"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { accountProfile } from "@/lib/account-profile.mjs";

export default function ProfileMenu() {
  const { client, user, ready } = useAuth();
  const pathname = usePathname();
  const menu = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedIn = user && !user.is_anonymous;
  const { displayName } = accountProfile(user);
  const initial = (displayName || "P").slice(0, 1).toUpperCase();
  useEffect(() => {
    const close = event => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "keydown" || !menu.current?.contains(event.target)) {
        if (menu.current) menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname]);
  async function signOut() {
    setBusy(true); setError("");
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch { setError("Could not sign out. Please try again."); }
    finally { setBusy(false); }
  }
  if (!ready) return <span className="profile-placeholder" aria-label="Checking account" />;
  if (!signedIn) return <Link className="header-signin" href="/account">Sign in</Link>;
  return <details className="profile-menu" ref={menu}>
    <summary className="profile-avatar" aria-label="Your profile">{initial}</summary>
    <div className="profile-popover">
      <strong>{displayName || "Your account"}</strong><span className="profile-email">{user.email}</span>
      {!displayName && <Link href="/account">Choose your public name</Link>}
      <Link href="/drawings">My drawings</Link><Link href="/account">Account</Link>
      <button type="button" disabled={busy} onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button>
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}
