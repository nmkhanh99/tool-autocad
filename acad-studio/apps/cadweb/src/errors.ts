export type CadWebErrorCode =
  | "ZIP_INVALID"
  | "ZIP_LIMIT"
  | "ZIP_PATH"
  | "ZIP_DUPLICATE"
  | "MANIFEST_INVALID"
  | "VERSION_UNSUPPORTED"
  | "INTEGRITY_ERROR"
  | "PAYLOAD_INVALID"
  | "GEOMETRY_INVALID"
  | "DELTA_INVALID"
  | "REVISION_MISMATCH";

export class CadWebError extends Error {
  readonly code: CadWebErrorCode;

  constructor(code: CadWebErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CadWebError";
    this.code = code;
  }
}
