// Deterministic dedupe keys for notifications that have no natural row UUID.
// notification_log.scheduled_dose_id is uuid not null, so non-dose
// notifications map (kind, discriminator) to a stable RFC-4122-shaped UUID.
import { createHash } from 'node:crypto';

export function deterministicNotificationUuid(kind: string, discriminator: string): string {
  const hash = createHash('sha256').update(`${kind}:${discriminator}`).digest('hex');
  const variantNibble = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variantNibble}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}
