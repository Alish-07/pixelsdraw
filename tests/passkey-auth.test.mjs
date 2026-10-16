import test from "node:test";
import assert from "node:assert/strict";
import { passkeyError, passkeyOriginAllowed, passkeysEnabled, registerAccountPasskey, signInWithAccountPasskey } from "../lib/passkey-auth.mjs";

test("passkeys are opt-in and bound to a compatible secure origin", () => {
  assert.equal(passkeysEnabled("true"), true);
  for (const value of ["false", "", true, null]) assert.equal(passkeysEnabled(value), false);
  assert.equal(passkeyOriginAllowed("https://pixelsdraw.com", "pixelsdraw.com"), true);
  assert.equal(passkeyOriginAllowed("https://www.pixelsdraw.com", "pixelsdraw.com"), true);
  assert.equal(passkeyOriginAllowed("http://localhost:3000", "localhost"), true);
  for (const [origin, rp] of [["http://pixelsdraw.com", "pixelsdraw.com"], ["https://evilpixelsdraw.com", "pixelsdraw.com"], ["https://pixelsdraw.com.evil.example", "pixelsdraw.com"], ["http://localhost:3000", "pixelsdraw.com"], ["https://pixelsdraw.com", "https://pixelsdraw.com"], ["https://pixelsdraw.com", "*.pixelsdraw.com"], ["bad", "pixelsdraw.com"]]) assert.equal(passkeyOriginAllowed(origin, rp), false);
});

test("passkey sign-in delegates verification to Supabase and rejects incomplete sessions", async () => {
  const controller = new AbortController(); let received;
  const client = { auth: { signInWithPasskey: async options => { received = options; return { data: { user: { id: "existing" }, session: {} } }; } } };
  assert.equal((await signInWithAccountPasskey(client, controller.signal)).id, "existing");
  assert.equal(received.options.signal, controller.signal);
  for (const data of [{}, { user: { is_anonymous: true }, session: {} }]) await assert.rejects(signInWithAccountPasskey({ auth: { signInWithPasskey: async () => ({ data }) } }));
});

test("registration requires a confirmed account and preserves cancellation", async () => {
  const controller = new AbortController(); let calls = 0;
  const client = { auth: {
    getUser: async () => ({ data: { user: { id: "account", email_confirmed_at: "2026-10-01" } } }),
    registerPasskey: async ({ options }) => { calls++; assert.equal(options.signal, controller.signal); return { data: { id: "credential" } }; },
  } };
  assert.equal((await registerAccountPasskey(client, controller.signal, "account")).id, "credential");
  for (const user of [null, { id: "account", is_anonymous: true }, { id: "account" }, { id: "other", email_confirmed_at: "2026-10-01" }]) {
    client.auth.getUser = async () => ({ data: { user } });
    await assert.rejects(registerAccountPasskey(client, controller.signal, "account"));
  }
  assert.equal(calls, 1);
  client.auth.getUser = async () => ({ data: { user: { id: "account", email_confirmed_at: "2026-10-01" } } });
  controller.abort();
  await assert.rejects(registerAccountPasskey(client, controller.signal, "account"));
  assert.equal(calls, 1);
  assert.match(passkeyError({ name: "NotAllowedError" }), /try again/);
  assert.match(passkeyError({ name: "SecurityError" }), /website address/);
  assert.equal(passkeyError({ message: "private server diagnostic" }).includes("private server"), false);
});
