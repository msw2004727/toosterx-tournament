/** Writes from a retired match generation must never revive a reset match. */
export function matchRecordMetadata(match) {
  return match?.resetRevision > 0 ? { resetRevision: match.resetRevision } : {};
}
export function matchWriteMetadata(match, writeNonce) {
  return match?.resetRevision > 0
    ? { ...matchRecordMetadata(match), writeNonce } : {};
}
