export type SyncErrorCode =
  | "authentication_required"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "artifact_invalid"
  | "upload_too_large"
  | "writer_session_conflict"
  | "writer_lease_expired"
  | "idempotency_key_reused"
  | "revision_conflict"
  | "model_epoch_conflict"
  | "source_fingerprint_conflict"
  | "checkpoint_state_mismatch";

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: SyncErrorCode,
    status: number,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
