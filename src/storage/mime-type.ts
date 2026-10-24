/** Match exact MIME types or a top-level wildcard such as image/*. */
export function matchesMimeType(mimeType: string, allowed: readonly string[]): boolean {
  const value = mimeType.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value)) return false;
  return allowed.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    return pattern === value ||
      (/^[a-z0-9!#$&^_.+-]+\/\*$/.test(pattern) &&
        value.startsWith(pattern.slice(0, -1)));
  });
}
