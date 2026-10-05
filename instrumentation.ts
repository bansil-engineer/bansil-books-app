// ============================================================
// Bansil Books Analytics — Next.js instrumentation hook
// Registers the P0 automatic audit cycle timer once at server startup.
// Only runs in the Node.js runtime (not Edge). A process-global symbol
// guards against duplicate timer registration across hot reloads.
// ============================================================

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Keep explicitly read-only preview sessions free of automatic audit cycles.
    if (process.env.BANSIL_READ_ONLY_SESSION === "1") return;

  const g = global as unknown as { __p0SchedulerTimer?: ReturnType<typeof setInterval> };

  // Guard against duplicate registration across hot reloads within the same process
  if (g.__p0SchedulerTimer) return;

  const { runAutomaticP0CycleIfDue } = await import("./app/lib/audit/p0/automatic-cycle-runner");

  g.__p0SchedulerTimer = setInterval(() => {
    runAutomaticP0CycleIfDue().catch(() => {
      // let a background error crash — failures are already recorded per-source inside the runner
    });
  }, 4 * 60 * 1000); // 4-minute tick — the due-check inside is a cheap local DB read
  }
}
