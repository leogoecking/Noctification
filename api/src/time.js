function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayISO(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addCycle(epochMs, repeat) {
  const dt = new Date(epochMs);
  if (repeat === "daily") dt.setDate(dt.getDate() + 1);
  else if (repeat === "weekly") dt.setDate(dt.getDate() + 7);
  else if (repeat === "monthly") dt.setMonth(dt.getMonth() + 1);
  else return null;
  return dt.getTime();
}

function normalizeDue(dueAt, repeat, now = Date.now()) {
  let due = Number(dueAt);
  if (!Number.isFinite(due)) return now + 60_000;
  if (due >= now - 60_000 || repeat === "none") return due;

  let safe = 0;
  while (due < now - 60_000 && safe < 60) {
    const next = addCycle(due, repeat);
    if (!Number.isFinite(next)) break;
    due = next;
    safe += 1;
  }
  return due;
}

module.exports = {
  todayISO,
  addCycle,
  normalizeDue,
};
