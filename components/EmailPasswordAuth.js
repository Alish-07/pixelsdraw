"use client";

import { useEffect, useRef, useState } from "react";
import { emailSignInEnabled } from "@/lib/site-config.mjs";
import { AuthFormError, passwordAuthError, passwordAuthRequest, PASSWORD_MIN_LENGTH } from "@/lib/password-auth.mjs";
import AuthCaptcha from "./AuthCaptcha";
import { captchaEnabled } from "@/lib/captcha.mjs";

export default function EmailPasswordAuth({ client, disabled = false, onBusyChange }) {
  const emailEnabled = emailSignInEnabled();
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const form = useRef(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function switchMode(next) {
    if (inFlight.current) return;
    form.current?.querySelectorAll('input[type="password"], input[data-password]').forEach(input => { input.value = ""; });
    setMode(next); setMessage(""); setShowPassword(false);
    setCaptchaToken(""); setCaptchaAttempt(value => value + 1);
  }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || disabled || (mode !== "login" && cooldown > 0)) return;
    const values = new FormData(event.currentTarget);
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setMessage("");
    try {
      await passwordAuthRequest(client, {
        mode, email: values.get("email"), password: values.get("password"), confirmation: values.get("confirmation"),
        name: values.get("name"), nickname: values.get("nickname"), origin: window.location.origin,
        returnTo: window.location.pathname + window.location.search, emailEnabled, captchaToken,
      });
      if (mode === "login") setMessage("You’re signed in.");
      else {
        setCooldown(60);
        setMessage(mode === "reset"
          ? "If this address has an account, a password-reset link is on its way. Check your inbox and spam folder."
          : "Check your inbox to continue. If this address is eligible, we’ve sent a verification link. Already registered? Log in or continue with Google.");
        if (mode === "signup") setMode("resend");
      }
    } catch (error) {
      setMessage(error instanceof AuthFormError ? error.message : passwordAuthError(error));
      if (error?.status === 429 && mode !== "login") setCooldown(60);
    } finally {
      setCaptchaToken(""); setCaptchaAttempt(value => value + 1);
      form.current?.querySelectorAll("input[data-password]").forEach(input => { input.value = ""; });
      inFlight.current = false; setBusy(false); onBusyChange?.(false);
    }
  }

  const locked = busy || disabled;
  const sendsEmail = mode !== "login";
  return <section className="email-password-auth" aria-label="Email and password">
    <div className="auth-mode-tabs" role="group" aria-label="Email account options">
      <button type="button" aria-pressed={mode === "login"} disabled={locked} onClick={() => switchMode("login")}>Log in</button>
      <button type="button" aria-pressed={mode === "signup"} disabled={locked || !emailEnabled} onClick={() => switchMode("signup")}>Create account</button>
    </div>
    <h3>{mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : mode === "resend" ? "Verify your email" : "Log in with email"}</h3>
    <form ref={form} className="password-auth-form" onSubmit={submit}>
      <fieldset disabled={locked}>
        {mode === "signup" && <div className="auth-name-fields">
          <label>Name<input name="name" autoComplete="name" maxLength={60} required /></label>
          <label>Nickname (optional)<input name="nickname" autoComplete="nickname" maxLength={60} /></label>
        </div>}
        <label>Email address<input type="email" name="email" autoComplete="username" placeholder="you@example.com" maxLength={254} required /></label>
        {["login", "signup"].includes(mode) && <>
          <label>Password<input key={mode} data-password type={showPassword ? "text" : "password"} name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined} maxLength={128} required /></label>
          {mode === "signup" && <><small>Use at least 12 characters. Your nickname is public; without one, we use your name.</small>
            <label>Confirm password<input data-password type={showPassword ? "text" : "password"} name="confirmation" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={128} required /></label></>}
          <button className="auth-text-button" type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide password" : "Show password"}</button>
        </>}
        <AuthCaptcha key={captchaAttempt} onToken={setCaptchaToken} />
        <button className="primary-button" disabled={locked || (captchaEnabled() && !captchaToken) || (sendsEmail && (!emailEnabled || cooldown > 0))}>{busy ? "Please wait…" : sendsEmail && cooldown ? `Try again in ${cooldown}s` : ({ login: "Log in", signup: "Create account", reset: "Send reset link", resend: "Resend verification email" })[mode]}</button>
      </fieldset>
    </form>
    <div className="auth-secondary-actions">
      <button type="button" className="auth-text-button" disabled={locked || !emailEnabled} onClick={() => switchMode("reset")}>Forgot password?</button>
      <button type="button" className="auth-text-button" disabled={locked || !emailEnabled} onClick={() => switchMode("resend")}>Resend verification email</button>
    </div>
    {!emailEnabled && <p className="email-unavailable-note">Email signup and password recovery are coming soon. Already have a password? You can still log in. Otherwise, continue with Google.</p>}
    {message && <p role="status" className="auth-message">{message}</p>}
  </section>;
}
