/**
 * The app has exactly one configuration value, and it is public by design.
 *
 * An OAuth client id is not a secret — it ships in every page that uses
 * Google sign-in. What protects the account is the authorised-origins list in
 * Google Cloud, not the secrecy of this string. There is no client secret
 * because the browser token flow does not use one, and no service key because
 * there is no server holding one.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

export function isConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}
