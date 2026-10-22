import { createHmac } from "node:crypto";

// Analytics never persists a raw network address. The digest groups visits
// without making the original address recoverable, while the mask is only a
// coarse operator-facing hint.
export function createVisitorIdentity(ipAddress: string, pepper: string) {
  return {
    digest: createHmac("sha256", pepper).update(`visitor:${ipAddress}`).digest("hex"),
    maskedIp: maskIpAddress(ipAddress)
  };
}

function maskIpAddress(ipAddress: string): string {
  const normalized = ipAddress.replace(/^::ffff:/, "");
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.*`;
  if (normalized.includes(":")) {
    const parts = normalized.split(":").filter(Boolean);
    return `${parts.slice(0, 3).join(":") || "::"}:*`;
  }
  return "unknown";
}
