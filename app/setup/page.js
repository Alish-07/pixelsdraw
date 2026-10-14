import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata = { title: "Connect Supabase · Pixel Art Studio" };

export default function SetupPage() {
  // This guide exposes implementation details that are useful only while the
  // project is being developed locally. Keep it out of alpha deployments.
  if (process.env.NODE_ENV === "production") notFound();

  return <main className="page-shell">
    <nav className="online-nav"><Link href="/events">← Shared competitions</Link><Link href="/">Local studio</Link></nav>
    <section className="competition setup-guide">
      <p className="eyebrow">One-time setup</p><h1>Connect your studio</h1>
      <p>Shared events need a Supabase project. The editor and local prototype already work without one.</p>
      <h2>1. Create a project</h2>
      <p>Open the <a href="https://supabase.com/dashboard">Supabase dashboard</a> and create a new project.
        Keep the database password private; this app does not need it.</p>
      <h2>2. Install the competition database</h2>
      <p>After the public-challenges upgrade, <a href="/setup/moderation-upgrade">download the October 11 moderation upgrade</a> and run it once. Reports are private and hiding is reversible. No moderator is assigned automatically: the site owner must explicitly choose a confirmed account before live report review is enabled.</p>
      <p>After the voting-timers upgrade, <a href="/setup/public-upgrade">download the public-challenges upgrade</a> and run it once. The existing timer scheduler will create and advance autonomous sprint and daily rounds. Run <code>select public.pixel_tick_due_events();</code> once to initialize them immediately. Only confirmed accounts can submit or vote in these public rounds.</p>
      <p>After the room-controls upgrade, <a href="/setup/voting-upgrade">download the October 10 voting-timers upgrade</a> and run it once. It gives voting a five-minute default deadline and automatic results. Existing open votes receive five minutes from installation; finished rooms stay finished.</p>
      <p>Then <a href="/setup/timer-scheduler">download the timer scheduler</a> and run it in the same Supabase SQL Editor. This enables Supabase Cron and checks due rooms every minute even when everyone closes the site. Verify the returned job is active. The scheduler file can safely be rerun; the database upgrade cannot.</p>
      <p>After the first October 7 upgrade, <a href="/setup/room-upgrade">download the room-controls upgrade</a> for unique nicknames, approval queues, countdown starts and roster privacy. Run each upgrade only once, in order.</p>
      <p><strong>Already connected?</strong> <a href="/setup/upgrade">Download only the October 7 competition upgrade</a> and run it once in Supabase’s SQL Editor. Do not rerun the fresh-project bundle on your existing database.</p>
      <p><a href="/setup/migration">Download the database migration</a>, open the SQL file, and copy its contents
        into your project’s SQL Editor. Run it once on a new project. It creates the event, entry, and ballot tables
        together with their access rules.</p>
      <h2>3. Add the public connection values</h2>
      <p>In the project’s Connect dialog or API settings, find the project URL and publishable key.
        Copy the project’s <code>.env.example</code> file to <code>.env.local</code> and fill in:</p>
      <pre>{`NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY`}</pre>
      <p>Use a public publishable key, never a secret or service-role key. Restart the local server after saving.
        For hosting, set these same environment variables before building the app.</p>
      <h2>4. Enable email sign-in</h2>
      <p>Under Authentication, enable the Email provider and keep email confirmation enabled.
        In URL Configuration, set Site URL to your website address. For local development use
        <code> http://localhost:3000</code>. Add <code>http://localhost:3000/events</code> and
        <code> http://localhost:3000/events/**</code> to the allowed redirect URLs.
        Add the equivalent HTTPS addresses when you deploy.</p>
      <p>The default magic-link email template works with this app. Use a configured email sender for real participants;
        the default Supabase email service is intended for initial testing and has delivery restrictions.</p>
      <h2>5. Test with participants</h2>
      <ol><li>Open Shared competitions, enter your email, and follow the sign-in link.</li>
        <li>Create an event. Copy its code or event link.</li><li>Open it in separate private browser windows,
          join with nicknames, and submit two entries using the locked canvas size.</li>
        <li>As the host, check activity counts and open voting. Confirm participants cannot use host controls.</li>
        <li>Vote for an entry you do not own. Finish voting as the host and check the results.</li></ol>
      <p>Events are public, while artwork stays hidden during submissions unless the host enables the gallery.
        One entry and ballot are allowed per participant identity. Private clubs and invite-only membership are not included.</p>
      <p>Links starting with localhost work only on your computer. Deploy the website with HTTPS before sharing links
        with people on other devices. This setup does not deploy or publish the app.</p>
    </section>
  </main>;
}
