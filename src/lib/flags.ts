/**
 * The flag for a country, from its ISO code.
 *
 * Regional indicator symbols: 'E' + 'S' become the two code points a font
 * renders as the Spanish flag. No image, no request, no dependency — and it
 * inherits the text colour and size like any other glyph.
 *
 * Returns an empty string for anything that is not two letters, since a broken
 * flag reads worse than none at all.
 */
export function flagOf(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";

  return String.fromCodePoint(
    ...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}
