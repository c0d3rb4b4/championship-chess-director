export type CaptureSocket = Pick<WebSocket, "addEventListener" | "send" | "close">;
export const sesseUrl = "https://analysis.sesse.net/analysis.pl";
export const leelaUrl = "wss://live.lczero.org/api/ws";
export function listenToLeela(
  socket: CaptureSocket,
  signal: AbortSignal,
  onFrame: (body: Record<string, unknown>) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const listeners = new AbortController();
    const finish = (error?: unknown) => {
      clearTimeout(idle);
      signal.removeEventListener("abort", stop);
      listeners.abort();
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    const stop = () => finish();
    const startIdleTimer = () => setTimeout(() => finish(Error("Leela socket idle")), 75_000);
    let idle = startIdleTimer();
    const options = { signal: listeners.signal };
    socket.addEventListener("close", () => finish(Error("Leela socket closed")), options);
    socket.addEventListener("error", () => finish(Error("Leela socket error")), options);
    socket.addEventListener("message", event => {
      clearTimeout(idle);
      idle = startIdleTimer();
      try {
        onFrame(JSON.parse(event.data));
      } catch (error) {
        finish(error);
      }
    }, options);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}
