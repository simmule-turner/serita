// The folders and files directly inside one folder, from a flat list of file entries.
// Folders exist only as the front part of a file's path, so a folder with no files is not shown.

const cmp = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/**
 * @param {{ path: string, size: number | null }[]} entries paths relative to the storage root
 * @param {string} [dir] "" for the root, otherwise a path ending in "/"
 * @returns {{ folders: string[], files: { name: string, size: number | null }[] }}
 */
export function children(entries, dir = '') {
  const folders = new Set();
  const files = [];
  for (const e of entries) {
    if (!e.path.startsWith(dir)) continue;
    const rest = e.path.slice(dir.length);
    const i = rest.indexOf('/');
    if (i < 0) files.push({ name: rest, size: e.size });
    else folders.add(rest.slice(0, i));
  }
  return { folders: [...folders].sort(cmp), files: files.sort((a, b) => cmp(a.name, b.name)) };
}

/** The folder above dir: "a/b/" gives "a/", "a/" gives "". */
export const parentDir = (dir) => dir.replace(/[^/]+\/$/, '');
