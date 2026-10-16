// Public names are explicitly chosen here, never inferred from a Google name.
export function accountProfile(user) {
  const metadata = user?.user_metadata || {};
  const name = typeof metadata.profile_name === "string" ? metadata.profile_name.trim() : "";
  const nickname = typeof metadata.profile_nickname === "string" ? metadata.profile_nickname.trim() : "";
  return { name, nickname, displayName: nickname || name };
}

export function draftOwner(user) {
  return user?.id ? `user:${user.id}` : "guest";
}
