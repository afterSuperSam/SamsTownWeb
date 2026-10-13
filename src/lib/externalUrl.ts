export interface ExternalUrlOptions {
  httpsOnly?: boolean;
}

// Stored links are treated as untrusted even when their editor is privileged.
// Returning null lets renderers remove navigation instead of emitting a
// browser-executable or credential-bearing URL.
export function safeExternalUrl(
  value: string | null | undefined,
  options: ExternalUrlOptions = {}
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = options.httpsOnly ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol);
    if (!allowed || url.username || url.password || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}
