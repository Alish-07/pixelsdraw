import test from "node:test";
import assert from "node:assert/strict";
import { passwordAuthError, passwordAuthRequest, passwordProblem, safeReturnPath, updateAccountPassword } from "../lib/password-auth.mjs";

const values = { email: " person@example.com ", password: "test-only long phrase", confirmation: "test-only long phrase", name: " Name ", nickname: " Sprite ", origin: "https://pixelsdraw.example", returnTo: "/events?host=1", emailEnabled: true };
function mockAuth(result = { data: { user: { id: "account" }, session: {} } }) {
  const calls = [];
  const auth = Object.fromEntries(["signInWithPassword", "signUp", "resetPasswordForEmail", "resend", "updateUser"].map(method => [method, async (...args) => { calls.push({ method, args }); return result; }]));
  auth.getUser = async () => ({ data: { user: { id: "account", email_confirmed_at: "2026-10-01" } } });
  return { auth, calls };
}

test("normal password login sends no email, even while email delivery is disabled", async () => {
  const client = mockAuth();
  await passwordAuthRequest(client, { ...values, mode: "login", emailEnabled: false });
  assert.deepEqual(client.calls, [{ method: "signInWithPassword", args: [{ email: "person@example.com", password: values.password }] }]);
});

test("signup stores only profile fields and preserves the room destination for confirmation", async () => {
  const client = mockAuth({ data: { user: { id: "new-account" }, session: null } });
  const result = await passwordAuthRequest(client, { ...values, mode: "signup" });
  assert.equal(result.session, null);
  assert.deepEqual(client.calls[0], { method: "signUp", args: [{ email: "person@example.com", password: values.password, options: { emailRedirectTo: "https://pixelsdraw.example/events?host=1", data: { profile_name: "Name", profile_nickname: "Sprite" } } }] });
  const noNickname = mockAuth();
  await passwordAuthRequest(noNickname, { ...values, mode: "signup", nickname: "" });
  assert.equal(noNickname.calls[0].args[0].options.data.profile_nickname, "");
});

test("reset and resend use distinct endpoints and never submit a password", async () => {
  const client = mockAuth();
  await passwordAuthRequest(client, { ...values, mode: "reset" });
  const resetUrl = new URL(client.calls[0].args[1].redirectTo);
  assert.equal(resetUrl.pathname, "/account/reset-password");
  assert.equal(resetUrl.searchParams.get("next"), "/events?host=1");
  await passwordAuthRequest(client, { ...values, mode: "resend" });
  assert.equal(client.calls[1].method, "resend");
  assert.equal(client.calls[1].args[0].type, "signup");
  assert.equal(JSON.stringify(client.calls).includes(values.password), false);
});

test("unconfigured delivery, invalid input and weak passwords are rejected before any request", async () => {
  const client = mockAuth();
  for (const mode of ["signup", "reset", "resend"]) await assert.rejects(passwordAuthRequest(client, { ...values, mode, emailEnabled: false }), /not available/);
  for (const email of ["", "invalid", "a @example.com"]) await assert.rejects(passwordAuthRequest(client, { ...values, mode: "login", email }), /valid email/);
  await assert.rejects(passwordAuthRequest(client, { ...values, mode: "signup", name: " " }), /name/);
  await assert.rejects(passwordAuthRequest(client, { ...values, mode: "signup", password: "short" }), /12 characters/);
  await assert.rejects(passwordAuthRequest(client, { ...values, mode: "signup", confirmation: "different" }), /do not match/);
  await assert.rejects(passwordAuthRequest(client, { ...values, mode: "login", origin: "http://public.example" }), /secure/);
  assert.equal(client.calls.length, 0);
  assert.match(passwordProblem("x".repeat(129), "x".repeat(129)), /128/);
});

test("redirect destinations cannot escape this website", () => {
  for (const path of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/\nevil.example", null]) assert.equal(safeReturnPath(path), "/account");
  assert.equal(safeReturnPath("/events/room?tab=draw#secret"), "/events/room?tab=draw");
  assert.equal(safeReturnPath("/events?host=1"), "/events?host=1");
});

test("password updates require a server-verified, unchanged account", async () => {
  const client = mockAuth();
  await updateAccountPassword(client, values.password, values.password, "account");
  assert.deepEqual(client.calls, [{ method: "updateUser", args: [{ password: values.password }] }]);
  for (const user of [null, { id: "guest", is_anonymous: true }, { id: "account" }, { id: "other-account", email_confirmed_at: "2026-10-01" }]) {
    const blocked = mockAuth(); blocked.auth.getUser = async () => ({ data: { user } });
    await assert.rejects(updateAccountPassword(blocked, values.password, values.password, "account"));
    assert.equal(blocked.calls.length, 0);
  }
});

test("auth failures stay helpful without exposing account existence or provider internals", async () => {
  const client = mockAuth({ error: { code: "invalid_credentials", status: 400 } });
  await assert.rejects(passwordAuthRequest(client, { ...values, mode: "login" }), { code: "invalid_credentials" });
  assert.match(passwordAuthError({ code: "invalid_credentials" }), /Email or password/);
  assert.match(passwordAuthError({ code: "email_not_confirmed" }), /Confirm your email/);
  assert.match(passwordAuthError({ status: 429 }), /wait/);
  assert.equal(passwordAuthError({ message: "internal error with private diagnostic data" }).includes("private diagnostic"), false);
});
