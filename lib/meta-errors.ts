export type MetaErrorStage = 'preflight' | 'graph_create' | 'session_create' | 'readback' | 'persist';
export type MetaErrorSource = 'graph' | 'session' | 'app';

export type StructuredMetaError = {
  source: MetaErrorSource;
  httpStatus?: number;
  metaCode?: number;
  metaSubcode?: number;
  title?: string;
  message: string;
  stage: MetaErrorStage;
  retryable: boolean;
  rawDiagnostic?: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function safeDiagnostic(value: unknown) {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (key, current) => {
    if (/token|cookie|dtsg|authorization|secret/i.test(key)) return '[REDACTED]';
    if (current && typeof current === 'object') {
      if (seen.has(current)) return '[CIRCULAR]';
      seen.add(current);
    }
    return current;
  });
  return json ? json.slice(0, 4000) : undefined;
}

export function toStructuredMetaError(
  error: unknown,
  context: { source: MetaErrorSource; stage: MetaErrorStage; httpStatus?: number },
): StructuredMetaError {
  const root = objectValue(error);
  const body = objectValue(root.body || root.responseBody || root.raw);
  const firstListedError = Array.isArray(body.errors) ? objectValue(body.errors[0]) : {};
  const nested = objectValue(body.error || root.error || firstListedError);
  const extensions = objectValue(nested.extensions || body.extensions || root.extensions);
  const message = String(
    nested.error_user_msg
      || nested.message
      || body.message
      || root.message
      || (error instanceof Error ? error.message : error)
      || 'Meta không trả về thông tin lỗi.',
  );
  const title = String(nested.error_user_title || body.title || root.title || '').trim() || undefined;
  const httpStatus = numberValue(root.httpStatus) || numberValue(root.status) || context.httpStatus;
  const metaCode = numberValue(nested.code) || numberValue(body.code) || numberValue(root.code) || numberValue(extensions.code);
  const metaSubcode = numberValue(nested.error_subcode) || numberValue(body.error_subcode) || numberValue(root.subcode) || numberValue(extensions.error_subcode);
  const retryable = nested.is_transient === true
    || root.retryable === true
    || httpStatus === 429
    || (httpStatus !== undefined && httpStatus >= 500);
  const raw = Object.keys(body).length ? body : Object.keys(root).length ? root : { message };
  return {
    source: context.source,
    httpStatus,
    metaCode,
    metaSubcode,
    title,
    message,
    stage: context.stage,
    retryable,
    rawDiagnostic: safeDiagnostic(raw),
  };
}

export class MetaCreationError extends Error {
  readonly errors: StructuredMetaError[];

  constructor(errors: StructuredMetaError[]) {
    super(errors.map((error) => `${error.stage}/${error.source}: ${error.message}`).join(' | ') || 'Không tạo được Business Manager.');
    this.name = 'MetaCreationError';
    this.errors = errors;
  }
}
