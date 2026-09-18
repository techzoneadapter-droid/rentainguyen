export const AD_ACCOUNT_FIELD_VARIANTS = [
  'id,account_id,name,account_status,disable_reason,currency,spend_cap,amount_spent,balance,min_daily_budget,timezone_id,timezone_name,timezone_offset_hours_utc,is_prepay_account,funding_source,funding_source_details,business,owner,created_time',
  'id,name,account_status,disable_reason,currency',
  'id,name,account_status',
  'id,name',
];

/** Only field/permission failures should advance to a smaller field set. */
export async function readWithFieldFallback<T>(
  variants: readonly string[],
  read: (fields: string) => Promise<T>,
  canRetry: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  for (const fields of variants) {
    try {
      return await read(fields);
    } catch (error) {
      lastError = error;
      if (!canRetry(error)) throw error;
    }
  }
  throw lastError;
}
