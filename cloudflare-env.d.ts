declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    META_ACCESS_TOKEN?: string;
    META_API_VERSION?: string;
    TOKEN_ENCRYPTION_KEY?: string;
  }
}
