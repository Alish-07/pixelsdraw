import Link from "next/link";
import PolicyPage from "@/components/PolicyPage";

export const metadata = {
  title: "Terms & community rules · Pixel Art Studio",
  description: "Artwork ownership, fair competition, community rules and support for the Pixel Art Studio beta.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <PolicyPage title="Terms & community rules" introduction="Pixel Art Studio is a beta pixel-art editor and competition platform. These terms describe the conditions for using the service. Questions or concerns can be sent to alishpandey07@gmail.com.">
    <section><h2>Your account and participation</h2>
      <p>Keep your sign-in account secure and use the service only where you are permitted to do so. Do not impersonate another person or access another account. Hosted rooms may allow nickname-only guests; public challenges require a confirmed account to enter or vote.</p>
      <p>Read the rules and deadlines for each competition. Hosts control their own room settings, while public challenges follow the displayed automatic schedule. A room code or direct link may be shared by anyone who has it.</p>
    </section>
    <section><h2>Your artwork stays yours</h2>
      <p>You retain ownership of your original artwork. Submit only content that you created or have permission to use. Do not present someone else&apos;s work as your own.</p>
      <p>Submitting artwork gives Pixel Art Studio permission to store, process and display it as needed to run the competition, gallery, results and moderation features. It does not transfer ownership to us or give other visitors a general license to reuse your work. Publicly displayed images can still be viewed or copied by visitors, so do not submit anything that must remain confidential.</p>
      <p>Use the contact below to request removal of content you own. Hiding an entry or deleting a room from a list is not permanent data erasure; see the <Link href="/privacy">privacy policy</Link>.</p>
    </section>
    <section><h2>Create and compete respectfully</h2>
      <ul>
        <li>No harassment, threats, hateful abuse, sexual exploitation or unlawful content.</li>
        <li>No sharing another person&apos;s private information without permission.</li>
        <li>No spam, impersonation, malicious links or infringement of others&apos; rights.</li>
        <li>No vote manipulation, automated abuse, multiple-account attempts to evade participation limits, or bypassing room and platform restrictions.</li>
        <li>Do not interfere with other participants, probe accounts without authorization or disrupt the service.</li>
      </ul>
    </section>
    <section><h2>Voting and results</h2>
      <p>Follow the displayed voting rules, including restrictions on self-voting and entry limits. Timers and server-side checks determine when submissions and ballots are accepted. An empty round or a round without enough eligible entries or votes may end without a winner.</p>
      <p>Results can change when an entry is hidden or restored after review. Rankings are not a guarantee of a prize, payment or endorsement. Any separate prize arrangement made by a host is not offered by this website.</p>
    </section>
    <section><h2>Reporting and moderation</h2>
      <p>Signed-in users can report visible public-challenge artwork. Reports do not automatically hide or disqualify entries. Authorized moderators can dismiss reports, hide artwork or restore it, and record a review note. Platform access or content may be restricted to address abuse or rule violations.</p>
      <p>For hosted-room issues, contact the host or email us. For a review of a moderation decision, copyright concern or other safety issue, email <a href="mailto:alishpandey07@gmail.com">alishpandey07@gmail.com</a> with the room or entry link and an explanation. Never include your password or sign-in link.</p>
    </section>
    <section><h2>Beta availability and backups</h2>
      <p>The service is still being developed. Features, limits and availability can change, and bugs or interruptions can affect drafts, submissions and results. We do not promise uninterrupted operation or that browser drafts can be recovered. Export important artwork and keep your own copies.</p>
      <p>These terms do not exclude rights or protections that cannot be excluded under applicable law.</p>
    </section>
    <section><h2>Changes and contact</h2>
      <p>Updates to these terms will be posted here with a revised date. Contact <a href="mailto:alishpandey07@gmail.com">alishpandey07@gmail.com</a> with questions before participating. Our <Link href="/privacy">privacy policy</Link> explains how accounts, artwork and activity information are handled.</p>
    </section>
  </PolicyPage>;
}
