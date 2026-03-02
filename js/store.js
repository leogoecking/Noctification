const state = {
  reminders: [],
  packages: [],
  modalId: null,

  alarmActive: false,
  nextTimer: null,

  swReady: false,

  critical: {
    acked: {},
    nagIntervalMs: 20000,
    beepIntervalMs: 8000,
    maxNagMinutes: 60
  },

  overdueQueue: [],
  processingQueue: false,
  queueSource: null,
};

const subs = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of subs) fn(state);
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}