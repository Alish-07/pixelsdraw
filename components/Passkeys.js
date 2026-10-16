"use client";

import { useEffect, useRef, useState } from "react";
import { passkeyError, passkeyOriginAllowed, passkeysEnabled, registerAccountPasskey, signInWithAccountPasskey } from "@/lib/passkey-auth.mjs";
import { emailSignInEnabled } from "@/lib/site-config.mjs";

function usePasskeySupport() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSupported(Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials
      && passkeyOriginAllowed(window.location.origin, process.env.NEXT_PUBLIC_PASSKEY_RP_ID))), 0);
    return () => clearTimeout(timer);
  }, []);
  return supported;
}

export function PasskeySignIn({ client, disabled = false, onBusyChange }) {
  const supported = usePasskeySupport();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const operation = useRef(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function signIn() {
    if (operation.current || disabled || !supported) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); onBusyChange?.(true); setMessage("");
    try { await signInWithAccountPasskey(client, controller.signal); }
    catch (error) { if (!controller.signal.aborted) setMessage(passkeyError(error)); }
    finally { operation.current = null; setBusy(false); onBusyChange?.(false); }
  }
  if (!passkeysEnabled()) return null;
  return <div className="passkey-signin"><button className="secondary-button" type="button" disabled={disabled || busy || !supported} onClick={signIn}>{busy ? "Checking passkey…" : "Continue with a passkey"}</button>
    {!supported && <p>Passkeys aren’t available on this browser or website address.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}

export function PasskeySettings({ client, user }) {
  const supported = usePasskeySupport();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState(null);
  const dialog = useRef(null);
  const operation = useRef(null);
  useEffect(() => {
    let cancelled = false;
    if (passkeysEnabled()) client.auth.passkey.list().then(({ data, error }) => {
      if (cancelled) return;
      if (error) setMessage("Could not load your passkeys. Please try again later.");
      else { setItems(data || []); setLoaded(true); }
    }).catch(() => { if (!cancelled) setMessage("Could not load your passkeys. Please try again later."); });
    return () => { cancelled = true; operation.current?.abort(); };
  }, [client]);
  async function add() {
    if (operation.current || busy || !supported) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setMessage("");
    try {
      const item = await registerAccountPasskey(client, controller.signal, user.id);
      if (!controller.signal.aborted) { setItems(previous => [...previous, item]); setMessage("Passkey added. You can use it next time you log in."); }
    } catch (error) { if (!controller.signal.aborted) setMessage(passkeyError(error)); }
    finally { operation.current = null; setBusy(false); }
  }
  const hasGoogle = user.app_metadata?.provider === "google" || user.app_metadata?.providers?.includes("google");
  const canRemove = items.length > 1 || hasGoogle || emailSignInEnabled();
  async function remove() {
    if (!target || busy || operation.current || !canRemove) return;
    operation.current = new AbortController();
    setBusy(true); setMessage("");
    try {
      const { error } = await client.auth.passkey.delete({ passkeyId: target.id });
      if (error) throw error;
      setItems(previous => previous.filter(item => item.id !== target.id));
      dialog.current?.close(); setTarget(null); setMessage("Passkey removed from your account.");
    } catch { setMessage("Could not remove that passkey. Please try again."); }
    finally { operation.current = null; setBusy(false); }
  }
  if (!passkeysEnabled()) return null;
  return <section className="account-profile passkey-settings" aria-labelledby="passkey-heading"><h2 id="passkey-heading">Passkeys</h2>
    <p>Use your device’s fingerprint, face recognition, PIN, or security key to log in. Keep Google or another sign-in method available as a backup.</p>
    {!supported && <p>Adding a passkey requires a supported browser on the configured website address.</p>}
    <button className="secondary-button" type="button" disabled={busy || !supported || !loaded} onClick={add}>{busy ? "Please wait…" : "Add a passkey"}</button>
    {loaded && !items.length && <p>You haven’t added a passkey yet.</p>}
    <ul className="passkey-list">{items.map(item => <li key={item.id}><div><strong>{item.friendly_name || "Passkey"}</strong><small>Added {new Date(item.created_at).toLocaleDateString()}</small></div>
      <button className="auth-text-button" type="button" disabled={busy || !canRemove} onClick={() => { setTarget(item); dialog.current.showModal(); }}>Remove</button></li>)}</ul>
    {!canRemove && items.length > 0 && <p>Add another passkey or a backup sign-in method before removing your last one.</p>}
    {message && <p role="status">{message}</p>}
    <dialog className="drawing-save-dialog" ref={dialog} aria-labelledby="remove-passkey-heading"><h2 id="remove-passkey-heading">Remove this passkey?</h2><p>You won’t be able to use “{target?.friendly_name || "Passkey"}” to sign in again. This cannot be undone; you can register a new passkey later.</p><button type="button" disabled={busy} onClick={() => { dialog.current.close(); setTarget(null); }}>Cancel</button><button type="button" disabled={busy || !canRemove} onClick={remove}>Remove passkey</button></dialog>
  </section>;
}
