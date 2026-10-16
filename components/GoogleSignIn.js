"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { exchangeGoogleCredential, googleNonce } from "@/lib/google-sign-in.mjs";
import { friendlyAuthError } from "@/lib/site-ui.mjs";

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
let identitySetup;
let activeButton = null;

function prepareIdentity() {
  if (!identitySetup) identitySetup = googleNonce().then(({ nonce, hashedNonce }) => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      nonce: hashedNonce,
      ux_mode: "popup",
      auto_select: false,
      callback: response => activeButton?.(response, nonce),
    });
  }).catch(error => { identitySetup = null; throw error; });
  return identitySetup;
}

export default function GoogleSignIn({ client, disabled = false, onBusyChange }) {
  const container = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!loaded || !clientId) return;
    let cancelled = false;
    async function receive(response, nonce) {
      if (cancelled || inFlight.current || disabled) return;
      inFlight.current = true; setBusy(true); onBusyChange?.(true); setMessage("");
      try {
        await exchangeGoogleCredential(client, response, nonce);
        // Reset Google's page-level nonce and preserve the current room/host URL.
        window.location.reload();
      } catch (error) {
        if (!cancelled) setMessage(friendlyAuthError(error, "Could not finish Google sign-in. Please try again or use email."));
      } finally {
        inFlight.current = false;
        onBusyChange?.(false);
        if (!cancelled) setBusy(false);
      }
    }
    prepareIdentity().then(() => {
      if (cancelled || !container.current) return;
      activeButton = receive;
      container.current.replaceChildren();
      const width = Math.max(200, Math.min(280, Math.floor(container.current.getBoundingClientRect().width)));
      window.google.accounts.id.renderButton(container.current, {
        type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill",
        width, click_listener: () => { if (!cancelled) activeButton = receive; },
      });
    }).catch(() => { if (!cancelled) setMessage("Google sign-in could not load. Refresh to retry, or use email."); });
    return () => { cancelled = true; if (activeButton === receive) activeButton = null; };
  }, [client, loaded, disabled, onBusyChange]);

  if (!clientId) return <p className="google-signin-status">Google sign-in is temporarily unavailable. You can use email below.</p>;
  return <div className="google-signin" aria-busy={busy}>
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setLoaded(true)} onError={() => setMessage("Google sign-in could not load. Refresh to retry, or use email.")} />
    <div ref={container} className="google-signin-button" inert={disabled || busy} />
    {!loaded && !message && <p role="status">Loading Google sign-in…</p>}
    {busy && <p role="status">Signing you in…</p>}
    {message && <p role="alert">{message}</p>}
  </div>;
}
