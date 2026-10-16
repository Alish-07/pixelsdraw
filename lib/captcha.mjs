export function captchaEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

// This is a form guard, not an access control. Supabase validates every token.
export function captchaOptions(token, required = captchaEnabled()) {
  if (required && !token) throw new Error("Complete the security check before continuing.");
  return token ? { captchaToken: token } : {};
}
