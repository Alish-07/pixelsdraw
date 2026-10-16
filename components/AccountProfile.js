"use client";

import { useRef, useState } from "react";
import { accountProfile } from "@/lib/account-profile.mjs";

export default function AccountProfile({ client, user }) {
  const profile = accountProfile(user);
  const [name, setName] = useState(profile.name);
  const [nickname, setNickname] = useState(profile.nickname);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function save(event) {
    event.preventDefault();
    if (saving.current) return;
    const cleanName = name.trim();
    if (!cleanName) { setMessage("Enter your name to save your profile."); return; }
    saving.current = true;
    setBusy(true); setMessage("");
    try {
      const { error } = await client.auth.updateUser({ data: {
        profile_name: cleanName.slice(0, 60), profile_nickname: nickname.trim().slice(0, 60),
      } });
      if (error) throw error;
      setMessage("Profile saved.");
    } catch { setMessage("Could not save your profile. Please try again."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="account-profile" aria-labelledby="profile-heading">
    <h2 id="profile-heading">Your profile</h2>
    <p>Edit your name anytime, or add a nickname if you prefer.</p>
    <form onSubmit={save}>
      <label>Name<input required name="name" autoComplete="name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
      <label><span>Nickname (optional)</span><input name="nickname" autoComplete="nickname" maxLength={60} value={nickname} onChange={event => setNickname(event.target.value)} /></label>
      <p id="profile-privacy">Want to keep your name private? Add a nickname. We use your nickname publicly, or your name if you leave it blank. Your email is not your public name.</p>
      <p aria-live="polite">Public name: <strong>{nickname.trim() || name.trim() || "Not chosen yet"}</strong></p>
      <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </section>;
}
