// The app interface: the one contract the core and the UI use for everything that touches the world.
// Each platform supplies an implementation. A capability the platform lacks is reported by
// capabilities() and throws CapabilityUnavailable when called. Nothing imitates a missing capability.

/**
 * @typedef {{ available: boolean, reason?: string }} Capability
 * @typedef {{ text: string, version: string }} ReadResult
 * @typedef {{ ok: true, version: string }
 *   | { ok: false, conflict: { theirs: string | null, theirsVersion: string | null } }} WriteResult
 *
 * @typedef {object} Storage
 * @property {(name: string) => Promise<ReadResult | null>} read  null when the file does not exist
 * @property {(name: string, text: string, opts?: { baseVersion?: string }) => Promise<WriteResult>} write
 *   baseVersion is the version last read; omit it only when creating a new file
 * @property {(prefix?: string) => Promise<string[]>} list  full names, sorted
 * @property {(prefix?: string, options?: { shallow?: boolean }) => Promise<{ name: string, size: number | null, folder?: boolean }[]>} entries
 *   full names with the size in bytes (null when the storage does not say), sorted by name. With shallow, a storage that can list one folder
 *   at a time (WebDAV) returns only the folder that holds the prefix, with its subfolders as { folder: true }; the others return every file
 * @property {(name: string) => Promise<void>} remove
 * @property {(name: string, cb: (name: string) => void) => () => void} watch  returns unsubscribe
 * @property {() => string[]} providers
 *
 * @typedef {object} AppInterface
 * @property {() => Record<string, Capability>} capabilities
 * @property {Storage} storage
 * @property {{ now: () => Date, timeZone: () => string }} clock
 * @property {{ schedule: (n: { id: string, at: Date, title: string, body?: string }) => Promise<void>,
 *             cancel: (id: string) => Promise<void> }} notify
 * @property {{ open: (url: string) => Promise<void> }} links
 * @property {{ read: () => Promise<string>, write: (text: string) => Promise<void> }} clipboard
 * @property {{ pickOpen: () => Promise<{ name: string, text: string } | null>,
 *              pickSave: (suggestedName: string, text: string) => Promise<boolean>,
 *              pickFolder: () => Promise<string | null> }} files
 * @property {{ run: (req: { language: string, code: string, vars?: object,
 *              limits?: { ms?: number } }) => Promise<{ value: unknown, output: string }> }} script
 */

/** The capability names every implementation reports. */
export const CAPABILITIES = Object.freeze(['storage', 'clock', 'notify', 'links', 'clipboard', 'files', 'script']);

/** A remote provider could not reach its server. Callers may queue work and retry later. */
export class NetworkUnavailable extends Error {
  /** @param {unknown} [cause] */
  constructor(cause) {
    super(`network unavailable${cause instanceof Error ? `: ${cause.message}` : ''}`);
    this.name = 'NetworkUnavailable';
    this.code = 'offline';
    this.cause = cause;
  }
}

export class CapabilityUnavailable extends Error {
  /**
   * @param {string} capability
   * @param {string} [reason]
   */
  constructor(capability, reason = 'not available on this platform') {
    super(`${capability}: ${reason}`);
    this.name = 'CapabilityUnavailable';
    this.code = 'unavailable';
    this.capability = capability;
  }
}
