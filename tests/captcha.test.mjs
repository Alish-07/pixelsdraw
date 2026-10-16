import test from "node:test";
import assert from "node:assert/strict";
import { captchaOptions } from "../lib/captcha.mjs";
import { passwordAuthRequest } from "../lib/password-auth.mjs";
import { exchangeGoogleCredential } from "../lib/google-sign-in.mjs";
import { participantSession } from "../lib/guest-auth.mjs";

const fields = {
  email: "test@example.com", password: "a test-only long phrase", confirmation: "a test-only long phrase",
  name: "Test", origin: "https://pixelsdraw.example", returnTo: "/events", emailEnabled: true,
  captchaRequired: true,
};

test("CAPTCHA configuration requires a fresh token when enabled", () => {
  assert.deepEqual(captchaOptions(undefined, false), {});
  assert.throws(() => captchaOptions("", true), /security check/);
  assert.deepEqual(captchaOptions("test-only-token", true), { captchaToken: "test-only-token" });
});

for (const mode of ["login", "signup", "reset", "resend"]) {
  test(`${mode} forwards its CAPTCHA token and rejects a missing token before making a request`, async () => {
    const calls = [];
    const auth = Object.fromEntries(["signInWithPassword", "signUp", "resetPasswordForEmail", "resend"].map(method => [method, async (...args) => {
      calls.push({ method, args });
      return { data: { user: { id: "account" }, session: {} } };
    }]));
    await assert.rejects(passwordAuthRequest({ auth }, { ...fields, mode }), /security check/);
    assert.equal(calls.length, 0);
    await passwordAuthRequest({ auth }, { ...fields, mode, captchaToken: "test-only-token" });
    assert.equal(calls.length, 1);
    const options = mode === "reset" ? calls[0].args[1] : calls[0].args[0].options;
    assert.equal(options.captchaToken, "test-only-token");
  });
}

test("Google ID-token sign-in also forwards CAPTCHA verification", async () => {
  let received;
  const client = { auth: { signInWithIdToken: async input => {
    received = input;
    return { data: { session: {}, user: { id: "google-account" } } };
  } } };
  await assert.rejects(exchangeGoogleCredential(client, { credential: "test-id-token" }, "nonce", "", true), /security check/);
  assert.equal(received, undefined);
  await exchangeGoogleCredential(client, { credential: "test-id-token" }, "nonce", "test-only-token", true);
  assert.equal(received.options.captchaToken, "test-only-token");
  assert.equal(received.nonce, "nonce");
});

test("guest creation requires verification but existing sessions do not create another account", async () => {
  let received;
  const guest = { id: "guest", is_anonymous: true };
  const client = { auth: {
    getSession: async () => ({ data: { session: null } }),
    signInAnonymously: async input => { received = input; return { data: { user: guest, session: {} } }; },
  } };
  await assert.rejects(participantSession(client, "Sprite", "", true), /security check/);
  assert.equal(received, undefined);
  assert.equal(await participantSession(client, "Sprite", "test-only-token", true), guest);
  assert.deepEqual(received.options, { captchaToken: "test-only-token", data: { nickname: "Sprite" } });
  client.auth.getSession = async () => ({ data: { session: { user: guest } } });
  client.auth.signInAnonymously = () => assert.fail("An existing session must be reused");
  assert.equal(await participantSession(client, "Sprite", "", true), guest);
});

test("session lookup failures never silently create a guest account", async () => {
  const client = { auth: {
    getSession: async () => ({ error: new Error("Connection interrupted") }),
    signInAnonymously: () => assert.fail("Do not create an account after a failed session lookup"),
  } };
  await assert.rejects(participantSession(client, "Sprite", "test-only-token", true), /Connection/);
});
