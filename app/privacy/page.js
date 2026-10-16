import Link from "next/link";
import PolicyPage from "@/components/PolicyPage";

export const metadata = {
  title: "Privacy · PixelsDraw",
  description: "How PixelsDraw handles accounts, artwork, competition activity and browser drafts.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <PolicyPage title="Privacy policy" introduction="This policy explains how PixelsDraw handles information when you draw, sign in, join competitions or report artwork. For privacy questions, contact alishpandey07@gmail.com.">
    <section><h2>Drawing on your device</h2>
      <p>The standalone editor saves editable drafts in your browser using IndexedDB and local storage. Signed-in drafts are separated by account; guest drafts stay with that browser or guest session. Preferences such as appearance, panel sizes and saved nicknames may also stay on your device. Drawing in the standalone editor does not by itself publish your artwork. Local drawings do not automatically sync to other devices, and browser storage is not a private vault on a shared computer.</p>
      <p>Browser drafts are not a cloud backup. Clearing site data, changing browsers or moving to another website address can make them unavailable. Export important work before making those changes.</p>
    </section>
    <section><h2>Accounts and Google sign-in</h2>
      <p>Supabase provides our authentication and database services. When you sign in with Google, Google shares basic identity information, which can include your account identifier, email address, name and profile picture. Supabase stores account identity information and manages your sign-in session. We use your account to identify you, associate entries and votes with you, manage room ownership and enforce access and participation rules.</p>
      <p>You can save a name and an optional nickname in your account profile. Your nickname is suggested for public participation, or your chosen name if no nickname is set. We do not automatically use your Google name as a public nickname. Profile changes do not rename existing competition entries; those keep their room nickname.</p>
      <p>We do not receive your Google password. The application does not request access to Gmail messages, Drive files, contacts or calendars. Google identity data is not used for advertising, sold or used to train AI models.</p>
      <p>Email-link sign-in, when available, uses the email address you provide to create or access your account and send authentication links. Guest participation in hosted rooms creates a temporary anonymous account associated with your nickname; it is not a promise that participation leaves no records.</p>
      <p>Authentication tokens are stored in your browser to keep you signed in. Signing out ends your local session, but does not delete your account or submitted artwork.</p>
    </section>
    <section><h2>Competitions and public information</h2>
      <p>We store competition settings, account or guest identifiers, nicknames, submitted artwork and titles, ballots, timestamps and participation status. Rooms can use presence updates to show whether someone is waiting, working or away.</p>
      <p>Public-challenge submissions, artist nicknames, scores and results may be visible to anyone according to the challenge phase and settings. In hosted rooms, the host can view submissions and participation details; visibility to other visitors depends on the room settings. Room codes and direct links can be shared, so do not treat them as confidential storage.</p>
      <p>Your email address and individual ballot choices are not displayed in the public gallery. Do not include private or sensitive information in nicknames, artwork, titles or reports.</p>
    </section>
    <section><h2>Reports, moderation and support</h2>
      <p>When you report artwork, we store the entry, your account identifier, the reason, details and review status. Reports are not public. Authorized moderators can review report details and the related artwork. Review actions and notes are recorded for accountability.</p>
      <p>Hiding artwork is reversible and does not delete the original artwork or historical ballots. Support messages contain whatever information you send us; include only what is necessary to explain the issue.</p>
    </section>
    <section><h2>Service providers and technical information</h2>
      <p>Vercel hosts the website, Supabase handles authentication and stored competition data, and Google handles Google sign-in. These providers may process network and technical information, such as IP addresses, browser information, request times and security logs, to deliver and protect their services. Provider processing can involve servers outside your country.</p>
      <p>The application does not include advertising trackers or a third-party marketing analytics integration. Essential browser storage supports drafts, preferences and authentication. Blocking that storage may affect these features.</p>
      <p>Learn more from <a href="https://policies.google.com/privacy">Google</a>, <a href="https://supabase.com/privacy">Supabase</a> and <a href="https://vercel.com/legal/privacy-notice">Vercel</a>.</p>
    </section>
    <section><h2>Retention and your choices</h2>
      <p>Accounts, submissions, competition history, ballots and moderation records are retained while stored in the service; there is currently no automatic deletion schedule. Archiving or soft-deleting a room does not permanently erase its records. Provider logs and backups may have separate retention periods.</p>
      <p>Contact <a href="mailto:alishpandey07@gmail.com">alishpandey07@gmail.com</a> to request access, correction or deletion of your personal information, or to raise a privacy concern. We may need to verify that the request relates to your account. Tell us the relevant room or entry, but never send passwords or sign-in links. There is not yet a self-service account-deletion page.</p>
      <p>You can remove this app in your Google Account connection settings to revoke Google access. This does not automatically remove records already stored here. You can separately clear local browser data, after exporting any drafts you wish to keep.</p>
    </section>
    <section><h2>Updates and contact</h2>
      <p>We will update this page when our data practices change. The date above identifies the current version. Questions about content or participation are covered by our <Link href="/terms">terms and community rules</Link>.</p>
    </section>
  </PolicyPage>;
}
