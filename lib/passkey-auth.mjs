export function passkeysEnabled(value = process.env.NEXT_PUBLIC_PASSKEYS_ENABLED) { return value === "true"; }

export function passkeyOriginAllowed(origin, rpId) {
  if (!rpId || /[/:*\s]/.test(rpId)) return false;
  try {
    const url = new URL(origin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return (url.protocol === "https:" || (local && url.protocol === "http:"))
      && (url.hostname === rpId || url.hostname.endsWith(`.${rpId}`));
  } catch { return false; }
}

export function passkeyError(error) {
  if (["NotAllowedError", "AbortError"].includes(error?.name) || /CANCEL|ABORT|TIMEOUT/i.test(error?.code || "")) return "No passkey was used. You can try again or continue with Google.";
  if (error?.name === "SecurityError" || /origin|rp_id/.test(error?.code || "")) return "Passkeys aren’t configured for this website address. Please continue with Google.";
  if (error?.status === 429) return "Too many attempts. Please wait a moment or continue with Google.";
  return "Could not use that passkey. Please try again or continue with Google.";
}

export async function signInWithAccountPasskey(client, signal) {
  const { data, error } = await client.auth.signInWithPasskey({ options: { signal } });
  if (error) throw error;
  if (!data?.session || !data?.user || data.user.is_anonymous) throw new Error("A confirmed account session is required.");
  return data.user;
}

export async function registerAccountPasskey(client, signal, expectedUserId) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data?.user || data.user.is_anonymous || !(data.user.email_confirmed_at || data.user.phone_confirmed_at)) throw new Error("Sign in to a confirmed account before adding a passkey.");
  if ((expectedUserId && data.user.id !== expectedUserId) || signal?.aborted) throw new Error("Your account changed. Please try again.");
  const result = await client.auth.registerPasskey({ options: { signal } });
  if (result.error) throw result.error;
  if (!result.data?.id) throw new Error("Passkey registration was not confirmed.");
  return result.data;
}
