export const TYPES = [["classic", "TIMED"], ["extra", "EXTRA"], ["platformer", "PLAT"]];
export const typeName = (type) => TYPES.find(([value]) => value === type)?.[1] ?? type;
// EXTRA owns physical tables and RPCs; the existing classic URLs/IDs stay valid.
export const tableFor = (type, name) => type === "extra" ? `extra_${name}` : name;

export function lengthSeconds(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^\d{1,3}s?$/.test(text)) return Number(text.replace(/s$/, ""));
  const clock = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const units = text.match(/^(\d{1,2})m(?:\s*([0-5]?\d)s)?$/);
  return units ? Number(units[1]) * 60 + Number(units[2] ?? 0) : null;
}

export function lengthError(type, value) {
  if (type === "platformer") return "";
  const seconds = lengthSeconds(value);
  if (seconds !== null && (type === "classic" ? seconds >= 1 && seconds <= 59 : seconds >= 60 && seconds <= 599)) return "";
  return type === "classic" ? "TIMED 길이는 1–59초로 입력해 주세요. (예: 23s)" : "EXTRA 길이는 1분–9분 59초로 입력해 주세요. (예: 1:30)";
}
