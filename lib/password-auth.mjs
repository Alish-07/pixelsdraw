export const PASSWORD_MIN_LENGTH = 12;
export class AuthFormError extends Error {}

export function passwordProblem(password, confirmation) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) return "Use at least 12 characters for your password.";
  if (password.length > 128) return "Use no more than 128 characters for your password.";
  if (password !== confirmation) return "The passwords do not match.";
  return "";
}

export function safeReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/account";
  const url = new URL(value, "https://pixelsdraw.invalid");
  return url.origin === "https://pixelsdraw.invalid" ? url.pathname + url.search : "/account";
}

export function passwordAuthError(error) {
  if (error?.status === 429 || /rate_limit|over_.*rate/.test(error?.code || "")) return "Too many attempts. Please wait a moment or continue with Google.";
  if (error?.code === "email_not_confirmed") return "Confirm your email before logging in. You can resend the verification email below.";
  if (error?.code === "invalid_credentials") return "Email or password is incorrect. If you joined with Google, use Continue with Google.";
  if (["weak_password", "validation_failed"].includes(error?.code)) return "Choose a longer password that meets the account’s password requirements.";
  if (error?.code === "same_password") return "Choose a password different from your current one.";
  if (["reauthentication_needed", "reauthentication_not_valid"].includes(error?.code)) return "Please sign in again before changing your password.";
  if (/fetch|network/i.test(error?.message || "")) return "Connection interrupted. Please try again.";
  return "Could not complete that request. Please try again, or continue with Google.";
}

export async function passwordAuthRequest(client, { mode, email, password, confirmation, name, nickname, origin, returnTo, emailEnabled }) {
  if (!["login", "signup", "reset", "resend"].includes(mode)) throw new AuthFormError("Choose a sign-in option.");
  if (mode !== "login" && !emailEnabled) throw new AuthFormError("Email verification and password recovery are not available yet. Please continue with Google.");
  const address = String(email || "").trim();
  if (!address || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AuthFormError("Enter a valid email address.");
  const base = new URL(origin);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && base.hostname === "localhost")) throw new AuthFormError("Sign-in requires a secure connection.");
  const emailRedirectTo = base.origin + safeReturnPath(returnTo);
  let result;
  if (mode === "login") {
    if (typeof password !== "string" || !password) throw new AuthFormError("Enter your password.");
    result = await client.auth.signInWithPassword({ email: address, password });
  } else if (mode === "signup") {
    const problem = passwordProblem(password, confirmation);
    if (problem) throw new AuthFormError(problem);
    if (!String(name || "").trim()) throw new AuthFormError("Enter your name.");
    result = await client.auth.signUp({ email: address, password, options: {
      emailRedirectTo, data: { profile_name: name.trim().slice(0, 60), profile_nickname: String(nickname || "").trim().slice(0, 60) },
    } });
  } else if (mode === "resend") {
    result = await client.auth.resend({ type: "signup", email: address, options: { emailRedirectTo } });
  } else {
    const redirect = new URL("/account/reset-password", base.origin);
    redirect.searchParams.set("next", safeReturnPath(returnTo));
    result = await client.auth.resetPasswordForEmail(address, { redirectTo: redirect.href });
  }
  if (result.error) throw result.error;
  if (mode === "login" && (!result.data?.session || !result.data?.user || result.data.user.is_anonymous)) throw new AuthFormError("Could not open your account. Please try again.");
  return result.data;
}

export async function updateAccountPassword(client, password, confirmation, expectedUserId) {
  const problem = passwordProblem(password, confirmation);
  if (problem) throw new AuthFormError(problem);
  // Verify the current authenticated account with the server, not a URL flag.
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data?.user || data.user.is_anonymous) throw new AuthFormError("Open a valid password-reset link before setting a password.");
  if (!(data.user.email_confirmed_at || data.user.phone_confirmed_at)) throw new AuthFormError("Confirm your account before setting a password.");
  if (expectedUserId && data.user.id !== expectedUserId) throw new AuthFormError("Your account changed. Open the reset link again.");
  const result = await client.auth.updateUser({ password });
  if (result.error) throw result.error;
  return result.data;
}
