export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

// Read each round's actual clock so existing daily rounds retain their labels.
export function challengeTiming(round) {
  const drawing = (Date.parse(round.submission_deadline) - Date.parse(round.round_start)) / 1000;
  const voting = (Date.parse(round.next_round_at) - Date.parse(round.submission_deadline)) / 1000;
  return { drawing: durationLabel(drawing), voting: durationLabel(voting),
    label: round.challenge_key === "sprint" ? "Quick play" : drawing >= 80000 ? "Daily challenge" : "Six-hour challenge" };
}
