// A join acknowledgement can only update the exact room and identity that joined.
// An authoritative snapshot always wins (including a later host decision).
export function roomWithJoinReceipt(event, userId, receipt) {
  if (!event || event.my_admission || !userId || !receipt ||
      !receipt.admission || receipt.roomId !== event.id || receipt.userId !== userId) return event;
  return { ...event, my_nickname: receipt.nickname, my_admission: receipt.admission };
}
