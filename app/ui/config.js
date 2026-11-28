// Settings kept on this device: plain settings and secrets (tokens, passwords), as two flat
// maps of string to string. The names match the settings file (core/settings-file.js).
// In the browser both live in the browser's own storage for this site, which is stated on the setup screen.

export const SETTING_KEYS = Object.freeze(['github.owner', 'github.repo', 'github.branch', 'webdav.url', 'webdav.username', 'view.mode', 'view.emacsKeys', 'org-hide-leading-stars', 'org-startup-indented', 'org-table-widget-wrap-columns', 'org-table-widget-max-width-fraction', 'org-table-widget-zebra-stripe', 'view.lineNumbers', 'view.wrap', 'view.fontSize', 'view.toolRowText', 'view.toolRowOutline', 'view.theme', 'view.font', 'view.paragraphSpacing', 'org.tagsColumn', 'session.restore', 'view.beep', 'view.keyLog', 'org-agenda-files', 'org-capture-templates', 'org-refile-settings', 'org-agenda-prefix-settings', 'org-archive-location', 'org-log-into-drawer', 'org-log-repeat', 'org-log-done', 'org-log-reschedule', 'org-log-redeadline', 'org-log-refile', 'org-log-note-clock-out', 'calendar-latitude', 'calendar-longitude', 'calendar-location-name', 'org-pretty-entities', 'org-pretty-entities-include-sub-superscripts', 'org-use-sub-superscripts', 'user-login-name', 'user-full-name', 'calendar-time-display-form', 'org-weather-format', 'org-weather-refresh-interval', 'org-weather-temperature-unit', 'org-weather-speed-unit', 'org-log-note-headings', 'org-support-shift-select', 'org-link-abbrev-alist', 'org-link-search-must-match-exact-headline', 'org-link-keep-stored-after-insertion', 'org-id-link-to-org-use-id', 'org-footnote-auto-label', 'org-footnote-section', 'org-footnote-define-inline', 'org-footnote-auto-adjust', 'org-archive-mark-done', 'org-archive-save-context-info', 'org-refile-allow-creating-parent-nodes', 'org-agenda-use-time-grid', 'org-agenda-include-diary', 'diary-file', 'calendar-date-style', 'calendar-holidays', 'holiday-local-holidays', 'diary-show-holidays-flag', 'org-contacts-files', 'org-contacts-birthday-property', 'serita-offline-files', 'serita-init-file', 'serita-extra-menu']);
export const SECRET_KEYS = Object.freeze(['github.token', 'webdav.password']);

/**
 * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }} store
 */
export function createConfig(store) {
  const load = (k) => {
    const raw = store.getItem(k);
    return raw === null ? {} : JSON.parse(raw);
  };
  const keep = (map, allowed) => Object.fromEntries(Object.entries(map).filter(([k, v]) => allowed.includes(k) && typeof v === 'string'));
  const listeners = new Set();
  const changed = () => { for (const cb of listeners) cb(); };
  return {
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    settings: () => load('serita.settings'),
    secrets: () => load('serita.secrets'),
    /** Sets values from a map; an empty string removes the key. */
    update({ settings = {}, secrets = {} }) {
      const s = { ...load('serita.settings'), ...keep(settings, SETTING_KEYS) };
      const x = { ...load('serita.secrets'), ...keep(secrets, SECRET_KEYS) };
      for (const m of [s, x]) for (const k of Object.keys(m)) if (m[k] === '') delete m[k];
      store.setItem('serita.settings', JSON.stringify(s));
      store.setItem('serita.secrets', JSON.stringify(x));
      changed();
    },
    /** Replaces everything, as an import does. */
    replaceAll({ settings, secrets }) {
      store.setItem('serita.settings', JSON.stringify(keep(settings, SETTING_KEYS)));
      store.setItem('serita.secrets', JSON.stringify(keep(secrets, SECRET_KEYS)));
      changed();
    },
    githubReady() {
      const s = load('serita.settings');
      return !!(s['github.owner'] && s['github.repo'] && load('serita.secrets')['github.token']);
    },
    webdavReady() {
      const s = load('serita.settings');
      return !!(s['webdav.url'] && s['webdav.username'] && load('serita.secrets')['webdav.password']);
    },
  };
}
