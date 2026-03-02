export function isValidTimeHM(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export function normalizeTimeHM(time) {
  return isValidTimeHM(time) ? time : "09:00";
}