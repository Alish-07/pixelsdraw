import { captchaOptions } from "./captcha.mjs";

export async function googleNonce(cryptoApi = globalThis.crypto) {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { nonce, hashedNonce };
}

export async function exchangeGoogleCredential(client, response, nonce, captchaToken, captchaRequired) {
  if (!nonce || typeof response?.credential !== "string" || !response.credential) throw new Error("Google did not return a sign-in credential.");
  // Supabase verifies the signature, audience and nonce before issuing a session.
  // Never decode a token to authorize users or store it in application storage.
  const security = captchaOptions(captchaToken, captchaRequired);
  const { data, error } = await client.auth.signInWithIdToken({ provider: "google", token: response.credential, nonce, ...(captchaToken ? { options: security } : {}) });
  if (error) throw error;
  if (!data?.session || !data?.user || data.user.is_anonymous) throw new Error("Google sign-in did not establish an account session.");
  return data.user;
}
