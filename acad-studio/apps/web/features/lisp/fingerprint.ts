"use client";

/** Dấu vân tay của một manifest sắp được duyệt.
 *
 * Phải khớp **từng byte** với `stableJson()` + `sha256()` của daemon: khi nhận
 * `PUT /:id/manifest`, máy chủ **tự tính lại** hash từ
 * `{resourceId, baseRevision, manifest}` và từ chối nếu khác giá trị đã dùng để
 * xin token. Lệch một dấu phẩy là mọi lượt duyệt trả 403 mà thông điệp lại nói
 * về "token thiếu hoặc hết hạn" — sai hướng hoàn toàn.
 *
 * Hai chỗ phải giống hệt daemon:
 *  · **thứ tự khoá** — sắp theo mã UTF-16, đúng như `Object.keys().sort()`;
 *  · **định dạng** — `JSON.stringify` của một object đã sắp khoá cho ra cùng
 *    chuỗi với cách daemon nối tay `{"key":value,...}`.
 */

export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

export async function manifestFingerprint(input: {
  resourceId: string;
  baseRevision: string;
  manifest: unknown;
}): Promise<string> {
  const payload = JSON.stringify(canonicalJson({
    resourceId: input.resourceId,
    baseRevision: input.baseRevision,
    manifest: input.manifest,
  }));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
