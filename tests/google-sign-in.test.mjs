import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exchangeGoogleCredential, googleNonce } from "../lib/google-sign-in.mjs";

test("Google receives the hashed nonce while Supabase receives its random original", async () => {
  const first = await googleNonce();
  const second = await googleNonce();
  assert.match(first.nonce, /^[a-f0-9]{64}$/);
  assert.equal(first.hashedNonce, createHash("sha256").update(first.nonce).digest("hex"));
  assert.notEqual(first.nonce, second.nonce);
  let supplied;
  const client = { auth: { signInWithIdToken: async options => { supplied = options; return { data: { session: {}, user: { id: "existing-user" } } }; } } };
  const user = await exchangeGoogleCredential(client, { credential: "test-token" }, first.nonce);
  assert.equal(user.id, "existing-user");
  assert.deepEqual(supplied, { provider: "google", token: "test-token", nonce: first.nonce });
});

test("missing credentials and failed verification never create an application session", async () => {
  const neverCalled = { auth: { signInWithIdToken: () => assert.fail("Missing credentials must not be submitted") } };
  for (const response of [null, {}, { credential: "" }, { credential: 123 }]) await assert.rejects(exchangeGoogleCredential(neverCalled, response, "nonce"));
  await assert.rejects(exchangeGoogleCredential(neverCalled, { credential: "test-token" }, ""));
  const rejected = { auth: { signInWithIdToken: async () => ({ error: new Error("Invalid nonce") }) } };
  await assert.rejects(exchangeGoogleCredential(rejected, { credential: "test-token" }, "nonce"), /Invalid nonce/);
  for (const data of [{}, { session: {}, user: { is_anonymous: true } }]) {
    const client = { auth: { signInWithIdToken: async () => ({ data }) } };
    await assert.rejects(exchangeGoogleCredential(client, { credential: "test-token" }, "nonce"), /account session/);
  }
});
