import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const migrations = [
    "202610040001_competitions.sql",
    "202610050001_event_join_codes.sql",
    "202610050002_nickname_participants.sql",
    "202610050003_live_rooms.sql",
    "202610050004_lock_voting_settings.sql",
    "202610050005_waiting_lobby.sql",
    "202610070001_competition_rules.sql",
    "202610070002_room_controls.sql",
    "202610100001_voting_timers.sql",
    "202610100002_public_challenges.sql",
    "202610110001_public_moderation.sql",
  ];
  const sql = (await Promise.all(migrations.map((file) =>
    readFile(path.join(process.cwd(), "supabase/migrations", file), "utf8"),
  ))).join("\n\n");
  return new Response(sql, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pixel-art-competitions.sql"',
    },
  });
}
