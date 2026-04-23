/**
 * lib/uuid5.ts
 *
 * Deterministic UUID v5 (SHA-1 based) using NAMESPACE_OID.
 * Matches Python's: uuid.uuid5(uuid.NAMESPACE_OID, name)
 *
 * Used to derive stable UUIDs from integer Va.id values so that
 * VaLoadState and VaPerformanceSnapshot rows can be joined to Va rows.
 *
 * Python:
 *   _VA_NS = uuid.NAMESPACE_OID  # 6ba7b812-9dad-11d1-80b4-00c04fd430c8
 *   def _va_uuid(va_id): return uuid.uuid5(_VA_NS, f"va:{va_id}")
 */
import { createHash } from "crypto";

// Python uuid.NAMESPACE_OID
const NAMESPACE_OID_HEX = "6ba7b8129dad11d180b400c04fd430c8";

/**
 * Compute UUID v5 for a name string under NAMESPACE_OID.
 * Result matches Python uuid.uuid5(uuid.NAMESPACE_OID, name).
 */
export function uuidV5Oid(name: string): string {
  const nsBuf = Buffer.from(NAMESPACE_OID_HEX, "hex");
  const nameBuf = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(nsBuf).update(nameBuf).digest();

  // Set version to 5: high nibble of byte 6
  hash[6] = (hash[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122: high 2 bits of byte 8
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.slice(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Derive the stable UUID for a Va row from its integer primary key.
 * Matches: uuid.uuid5(NAMESPACE_OID, f"va:{va_id}")
 */
export function vaUuid(vaId: number): string {
  return uuidV5Oid(`va:${vaId}`);
}
