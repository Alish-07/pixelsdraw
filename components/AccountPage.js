"use client";

import Link from "next/link";
import AccountPanel from "./AccountPanel";
import { useAuth } from "./AuthProvider";
import AccountProfile from "./AccountProfile";

export default function AccountPage() {
  const { client, user, ready } = useAuth();
  return <div className="account-page"><h1>Your account</h1><p>Create, save, and come back to your next idea.</p>
    {client ? <AccountPanel client={client} user={user} ready={ready} general /> : <p>Sign-in is temporarily unavailable. You can still draw and save on this device.</p>}
    {ready && user && !user.is_anonymous && <AccountProfile key={user.id} client={client} user={user} />}
    <Link className="button-link" href="/drawings">My drawings</Link>
  </div>;
}
