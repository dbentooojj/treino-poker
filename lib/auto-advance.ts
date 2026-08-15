type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type AutoAdvanceScheduler = {
  now: () => number;
  setInterval: (callback: () => void, delayMs: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export type AutoAdvanceTimer = {
  cancel: () => void;
};

export function startAutoAdvanceTimer({
  durationMs = 5_000,
  onTick,
  onElapsed,
  scheduler = browserScheduler,
}: {
  durationMs?: number;
  onTick: (remainingSeconds: number) => void;
  onElapsed: () => void;
  scheduler?: AutoAdvanceScheduler;
}): AutoAdvanceTimer {
  const deadline = scheduler.now() + durationMs;
  let cancelled = false;
  let interval: TimerHandle | null = null;
  let timeout: TimerHandle | null = null;

  const tick = () => {
    if (cancelled) return;
    onTick(Math.max(1, Math.ceil((deadline - scheduler.now()) / 1_000)));
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (interval !== null) scheduler.clearInterval(interval);
    if (timeout !== null) scheduler.clearTimeout(timeout);
    interval = null;
    timeout = null;
  };

  tick();
  interval = scheduler.setInterval(tick, 100);
  timeout = scheduler.setTimeout(() => {
    if (cancelled) return;
    cancelled = true;
    if (interval !== null) scheduler.clearInterval(interval);
    interval = null;
    timeout = null;
    onElapsed();
  }, durationMs);

  return { cancel };
}

const browserScheduler: AutoAdvanceScheduler = {
  now: () => Date.now(),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};
