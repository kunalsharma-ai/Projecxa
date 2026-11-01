/** ISO 3166-1 alpha-2 codes for common fieldwork markets, with a default language. */
export const COUNTRIES: { code: string; name: string; lang: string; currency: string }[] = [
  ['US', 'United States', 'en', 'USD'], ['CA', 'Canada', 'en', 'CAD'], ['MX', 'Mexico', 'es', 'MXN'], ['BR', 'Brazil', 'pt', 'BRL'],
  ['AR', 'Argentina', 'es', 'ARS'], ['CL', 'Chile', 'es', 'CLP'], ['CO', 'Colombia', 'es', 'COP'], ['GB', 'United Kingdom', 'en', 'GBP'],
  ['IE', 'Ireland', 'en', 'EUR'], ['DE', 'Germany', 'de', 'EUR'], ['FR', 'France', 'fr', 'EUR'], ['ES', 'Spain', 'es', 'EUR'],
  ['IT', 'Italy', 'it', 'EUR'], ['NL', 'Netherlands', 'nl', 'EUR'], ['BE', 'Belgium', 'nl', 'EUR'], ['CH', 'Switzerland', 'de', 'CHF'],
  ['AT', 'Austria', 'de', 'EUR'], ['SE', 'Sweden', 'sv', 'SEK'], ['NO', 'Norway', 'no', 'NOK'], ['DK', 'Denmark', 'da', 'DKK'],
  ['FI', 'Finland', 'fi', 'EUR'], ['PL', 'Poland', 'pl', 'PLN'], ['PT', 'Portugal', 'pt', 'EUR'], ['TR', 'Turkey', 'tr', 'TRY'],
  ['AE', 'United Arab Emirates', 'en', 'AED'], ['SA', 'Saudi Arabia', 'ar', 'SAR'], ['ZA', 'South Africa', 'en', 'ZAR'],
  ['IN', 'India', 'en', 'INR'], ['CN', 'China', 'zh', 'CNY'], ['JP', 'Japan', 'ja', 'JPY'], ['KR', 'South Korea', 'ko', 'KRW'],
  ['SG', 'Singapore', 'en', 'SGD'], ['MY', 'Malaysia', 'ms', 'MYR'], ['ID', 'Indonesia', 'id', 'IDR'], ['PH', 'Philippines', 'en', 'PHP'],
  ['TH', 'Thailand', 'th', 'THB'], ['VN', 'Vietnam', 'vi', 'VND'], ['AU', 'Australia', 'en', 'AUD'], ['NZ', 'New Zealand', 'en', 'NZD'],
].map(([code, name, lang, currency]) => ({ code, name, lang, currency }));

export const countryName = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

export function flag(code: string) {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
