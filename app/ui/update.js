// Finding out that a new version is waiting, and asking it which version it is.
// The new worker waits until the user chooses to restart; nothing here applies it by itself.

/** Ask a service worker for its version. @param {{ postMessage(m: any, t: any[]): void }} worker */
export function askVersion(worker, channel = MessageChannel) {
  return new Promise((resolve) => {
    const c = new channel();
    c.port1.onmessage = (e) => resolve(e.data);
    worker.postMessage({ type: 'version' }, [c.port2]);
  });
}

/**
 * Calls onFound(worker) once for each new worker that is installed and waiting, when an older one is in control.
 * @param {{ waiting: any, installing: any, addEventListener(t: string, f: () => void): void }} registration
 * @param {{ controller: any }} container
 */
export function watchUpdates(registration, container, onFound) {
  const seen = new Set();
  const found = (w) => { if (w && container.controller && !seen.has(w)) { seen.add(w); onFound(w); } };
  found(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const w = registration.installing;
    w.addEventListener('statechange', () => { if (w.state === 'installed') found(w); });
  });
}
