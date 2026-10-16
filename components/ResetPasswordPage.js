"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { AuthFormError, passwordAuthError, safeReturnPath, updateAccountPassword, PASSWORD_MIN_LENGTH } from "@/lib/password-auth.mjs";

export default function ResetPasswordPage() {
  const { client, user, ready } = useAuth();
  return <ResetPasswordForm key={user?.id || "guest"} client={client} user={user} ready={ready} />;
}

function ResetPasswordForm({ client, user, ready }) {
  const returnTo = safeReturnPath(useSearchParams().get("next"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  async function save(event) {
    event.preventDefault();
    if (inFlight.current || !client || !user || user.is_anonymous) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      await updateAccountPassword(client, data.get("password"), data.get("confirmation"), user.id);
      form.reset(); setDone(true);
    } catch (error) { setMessage(error instanceof AuthFormError ? error.message : passwordAuthError(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="account-page"><h1>Set a new password</h1>
    {!ready ? <p role="status">Checking your reset link…</p> : done ? <section className="account-panel"><h2>Password updated</h2><p>Your new password is ready to use next time you log in.</p><Link className="button-link" href={returnTo}>Continue</Link></section>
      : !client || !user || user.is_anonymous ? <section className="account-panel"><p>Open the password-reset link from your email to continue. If the link expired, request a new one from the login page.</p><Link href="/account">Back to login</Link></section>
      : <section className="account-panel"><p>Set a new password for <strong>{user.email}</strong>. Use at least 12 characters.</p>
        <form className="password-auth-form" onSubmit={save}><fieldset disabled={busy}>
          <label>New password<input type="password" name="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={128} required /></label>
          <label>Confirm new password<input type="password" name="confirmation" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={128} required /></label>
          <button className="primary-button">{busy ? "Updating…" : "Update password"}</button>
        </fieldset></form>{message && <p role="status">{message}</p>}
      </section>}
  </div>;
}
