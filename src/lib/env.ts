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

/**
 * Where this album lives publicly, without a trailing slash.
 *
 * A function rather than a constant so it is read when asked, not once when
 * the module loads: the latter cannot be exercised by a test at all.
 *
 * Needed because a chip carries one absolute URL for ever. Everything else
 * works fine off `window.location.origin`; a sticker written from a dev server
 * would not, and would say so only when tapped months later.
 */
export function siteUrl(): string {
  return trimSlashes(process.env.NEXT_PUBLIC_SITE_URL ?? "");
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The URL of a place: what goes on its chip, and what the copy button hands you.
 *
 * The public address wins over wherever you happen to be looking from, so the
 * URL you copy on a laptop is the one that will work on a phone.
 */
export function placeUrl(slug: string, origin: string): string {
  return `${siteUrl() || trimSlashes(origin)}/t/${slug}`;
}
