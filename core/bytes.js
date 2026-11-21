// Size of a text in bytes when saved as UTF-8, and a short readable form of a size.

/** @param {string} text @returns {number} */
export const byteLength = (text) => new TextEncoder().encode(text).length;

/**
 * @param {number | null} n bytes, or null when unknown
 * @returns {string} "" when unknown, otherwise like "812 B", "3.4 KB", "1.2 MB"
 */
export function formatSize(n) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
