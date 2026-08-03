/**
 * Identifier generation.
 *
 * The previous scheme was `TSK-${1000 + tasks.length + 1}`, which reuses an id
 * as soon as any task is deleted — the exact duplicate-record failure the brief
 * rules out. Ids are now globally unique and generated without coordinating
 * with the sheet.
 *
 * Task ids keep a readable `TSK-` prefix (people quote them in conversation)
 * followed by a collision-resistant suffix.
 */

/**
 * Random hex string of `bytes` length, using WebCrypto where available and
 * falling back to `Math.random` only if it is not. Available in both the Node
 * server runtime and every supported browser.
 */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const webcrypto = globalThis.crypto;
  if (webcrypto?.getRandomValues) {
    webcrypto.getRandomValues(buffer);
  } else {
    for (let i = 0; i < bytes; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A sortable, unique id: base-36 timestamp + random suffix.
 *
 * The timestamp prefix means ids sort chronologically, which keeps activity-log
 * rows in a sensible order even when written out of sequence. The random suffix
 * makes same-millisecond collisions vanishingly unlikely — the previous
 * `Date.now()`-only ids collided whenever two records were created in the same
 * tick, producing duplicate React keys.
 */
function uniqueId(): string {
  return `${Date.now().toString(36)}${randomHex(6)}`;
}

export function newTaskId(): string {
  return `TSK-${uniqueId()}`;
}

export function newMasterItemId(category: string): string {
  const slug = category.toLowerCase().replace(/[^a-z]/g, '').slice(0, 6);
  return `${slug || 'item'}-${uniqueId()}`;
}

export function newActivityLogId(): string {
  return `log-${uniqueId()}`;
}

export function newSubtaskId(): string {
  return `st-${uniqueId()}`;
}

export function newCommentId(): string {
  return `c-${uniqueId()}`;
}

export function newNotificationId(): string {
  return `notif-${uniqueId()}`;
}

/** Client-generated key used to make a write idempotent across retries. */
export function newRequestId(): string {
  return `req-${uniqueId()}`;
}
