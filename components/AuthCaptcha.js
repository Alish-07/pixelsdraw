"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { captchaEnabled } from "@/lib/captcha.mjs";

export default function AuthCaptcha({ onToken }) {
  const container = useRef(null);
  const callback = useRef(onToken);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { callback.current = onToken; }, [onToken]);

  useEffect(() => {
    if (!loaded || !container.current || !captchaEnabled()) return;
    let active = true;
    const clear = () => { if (active) callback.current(""); };
    const id = window.turnstile.render(container.current, {
      sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      theme: "auto", size: "flexible", "response-field": false,
      callback: token => { if (active) { callback.current(token); setMessage(""); } },
      "expired-callback": clear,
      "timeout-callback": clear,
      "error-callback": () => {
        clear();
        if (active) setMessage("Security check interrupted. Please retry or check your connection.");
      },
    });
    return () => { active = false; window.turnstile.remove(id); };
  }, [loaded, attempt]);

  if (!captchaEnabled()) return null;
  return <div className="auth-captcha">
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive"
      onReady={() => setLoaded(true)} onLoad={() => setLoaded(true)}
      onError={() => setMessage("The security check could not load. Check your connection and refresh this page.")} />
    <div ref={container} />
    {!loaded && !message && <p role="status">Loading security check…</p>}
    {message && <p role="alert">{message}</p>}
    {loaded && message && <button type="button" className="auth-text-button" onClick={() => {
      onToken(""); setMessage(""); setAttempt(value => value + 1);
    }}>Retry security check</button>}
  </div>;
}
