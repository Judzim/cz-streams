/**
 *
 * @param {string} time
 */
export function timeToSeconds(time: string) {
  const [secs, mins = 0, hours = 0] = time
    .split(":")
    .reverse()
    .map((i) => parseInt(i, 10));

  return secs + mins * 60 + hours * 3600;
}

/**
 * @param {string} sizeStr — e.g. "4.82 GB", "1,5 GB", "850MB", "2.1 GB"
 */
export function sizeToBytes(sizeStr: string) {
  if (!sizeStr) return 0;

  // Normalize: strip whitespace, treat comma as decimal separator (cz/sk sites)
  const normalized = sizeStr.replace(/\s+/g, "").replace(",", ".");
  const match = normalized.match(/([\d.]+)([KMGT]?B)/i);
  if (!match) return 0;

  const sizeNum = parseFloat(match[1]);
  if (isNaN(sizeNum)) return 0;

  const unit = match[2].toUpperCase();
  const sizeMul =
    unit === "KB" ? 1024
    : unit === "MB" ? 1048576
    : unit === "GB" ? 1073741824
    : unit === "TB" ? 1099511627776
    : 1;

  return sizeNum * sizeMul;
}

/**
 * @param {number} bytes
 */
export function bytesToSize(bytes: number) {
  const suffixes = ["", "kB", "MB", "GB", "TB"];
  let b = bytes;
  let idx = 0;

  while (b > 1000) {
    b = b / 1024;
    idx += 1;
  }
  return `${Math.round(b * 10) / 10}${suffixes[idx]}`;
}
