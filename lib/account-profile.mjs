// A saved profile name always wins over later Google account-name updates.
export function accountProfile(user) {
  const metadata = user?.user_metadata || {};
  const savedName = typeof metadata.profile_name === "string" ? metadata.profile_name.trim() : "";
  const usesGoogle = user?.app_metadata?.provider === "google"
    || user?.app_metadata?.providers?.includes("google")
    || user?.identities?.some(identity => identity.provider === "google");
  const googleName = usesGoogle ? [metadata.full_name, metadata.name].find(value => typeof value === "string" && value.trim()) : "";
  const name = savedName || (googleName || "").trim().slice(0, 60);
  const nickname = typeof metadata.profile_nickname === "string" ? metadata.profile_nickname.trim() : "";
  return { name, nickname, displayName: nickname || name };
}

export function draftOwner(user) {
  return user?.id ? `user:${user.id}` : "guest";
}
