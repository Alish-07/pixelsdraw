# Hosted competition checklist

Use the existing [competition lobby](https://pixel-art-studio-alpha-one.vercel.app/events).
Display the six-digit room code. Guests open the room with that code, then choose a
nickname and join. Keep **Copy direct link** as a backup if a guest mistypes the code.
No change to the club-site redirect is needed.

- Set admission to **Auto admit** if you want spectators to vote without approval.
  **Wait for approval** and **Stop new participants** also apply during voting.
- During voting, new guests choose **Join as audience**. They get a ballot without
  drawing or submitting anything. Artists can vote for other entries. Each session
  gets one ballot; saving again replaces it. Guests should keep the same tab and
  browser session so their entry and ballot remain associated with them.
- Before the event, use a separate test room on the actual school network. Join from
  iOS Safari and Android Chrome, submit several 32×32 drawings, and verify spectators
  can open the gallery and vote before the clock hits zero. Ask attendees to join a
  few minutes early; their browser may ask for a human check. Don't disable Turnstile
  or assume that all guests will pass without interaction.
- For a full 20–30-person rehearsal, use real browsers and a separate room. Compare
  the host's ballot count to the number of voters, replace one ballot, and record
  the final order. The isolated database suite exercises 28 identities, 16 entries
  and ballot replacements near the deadline. It does not measure live network or
  CAPTCHA capacity.
