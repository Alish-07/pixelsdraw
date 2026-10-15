"use client";

import Link from "next/link";
import AccountPanel from "./AccountPanel";
import { useAuth } from "./AuthProvider";

export default function AccountPage() {
  const { client, user, ready } = useAuth();
  return <div className="account-page"><h1>Your account</h1><p>Create, save, and come back to your next idea.</p>
    {client ? <AccountPanel client={client} user={user} ready={ready} general /> : <p>Sign-in is temporarily unavailable. You can still draw and save on this device.</p>}
    <Link className="button-link" href="/drawings">My drawings</Link>
  </div>;
}
