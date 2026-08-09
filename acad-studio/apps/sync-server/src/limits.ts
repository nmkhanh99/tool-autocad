export const MAX_CADWEB_ARTIFACT_BYTES = 256 * 1024 * 1024;

export function resolveCadWebArtifactByteLimit(
  value = MAX_CADWEB_ARTIFACT_BYTES,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CADWEB_ARTIFACT_BYTES) {
    throw new RangeError(
      `artifact byte limit must be between 1 and ${MAX_CADWEB_ARTIFACT_BYTES}`,
    );
  }
  return value;
}
