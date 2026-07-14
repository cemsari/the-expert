// Typed localStorage wrapper with the quota guard baked in (the v2.6 fix,
// designed in from the start this time).

let warned = false;

export function loadLS<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return def;
    return (JSON.parse(raw) as T) ?? def;
  } catch {
    return def;
  }
}

// Returns true on success. On quota failure for an array value, prunes to the
// newest half and retries once; warns the user once via the callback.
export function saveLS<T>(key: string, value: T, onQuota?: () => void): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (Array.isArray(value) && value.length > 40) {
      try {
        const half = value.slice(-Math.floor(value.length / 2));
        localStorage.setItem(key, JSON.stringify(half));
        return true;
      } catch {
        /* fall through */
      }
    }
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn("The Expert: browser storage is full or unavailable.", e);
      onQuota?.();
    }
    return false;
  }
}

export function removeLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
