import { captchaOptions } from "./captcha.mjs";

export async function participantSession(client, nickname, captchaToken, captchaRequired) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;
  const { data, error } = await client.auth.signInAnonymously({
    options: { ...captchaOptions(captchaToken, captchaRequired), data: { nickname } },
  });
  if (error) throw error;
  if (!data?.user || !data?.session) throw new Error("Could not join this room. Please try again.");
  return data.user;
}
