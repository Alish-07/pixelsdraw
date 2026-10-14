import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const sql = await readFile(path.join(process.cwd(), "supabase/migrations/202610070002_room_controls.sql"), "utf8");
  return new Response(sql, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="room-controls-upgrade.sql"' } });
}
