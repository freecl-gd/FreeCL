export function canManage(actorId: string, root: boolean, targetId: string, targetRole: number | null) {
  return actorId !== targetId && targetRole !== 0 && (targetRole === null || root);
}

export function banAttributes(input: Record<string, unknown>, now = Date.now()) {
  if (input.action === "unban") return { ban_duration: "none", app_metadata: { banned_permanently: false }, until: null };
  if (input.permanent === true) {
    return { ban_duration: "876000h", app_metadata: { banned_permanently: true }, until: null };
  }
  const months = input.months;
  const end = new Date(now);
  const day = end.getUTCDate();
  if (typeof months === "number" && Number.isInteger(months) && months >= 1) {
    end.setUTCMonth(end.getUTCMonth() + months);
    // Jan 31 + 1 month is the last day of February, not March 3.
    if (end.getUTCDate() !== day) end.setUTCDate(0);
  }
  const seconds = Math.ceil((end.getTime() - now) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 876000 * 3600) {
    throw new Error("밴 기간은 1개월 이상의 정수로 입력해 주세요. (100년 미만)");
  }
  return { ban_duration: `${seconds}s`, app_metadata: { banned_permanently: false }, until: end.toISOString() };
}
