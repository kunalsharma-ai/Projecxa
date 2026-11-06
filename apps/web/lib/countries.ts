/**
 * Every ISO 3166-1 alpha-2 country and territory, sorted by English name, with its main survey
 * language and local currency (both only defaults: people change them per market).
 */
export const COUNTRIES: { code: string; name: string; lang: string; currency: string }[] = ([
  ['AF', "Afghanistan", 'fa', 'AFN'], ['AX', "Åland Islands", 'sv', 'EUR'], ['AL', "Albania", 'sq', 'ALL'], ['DZ', "Algeria", 'ar', 'DZD'],
  ['AS', "American Samoa", 'en', 'USD'], ['AD', "Andorra", 'ca', 'EUR'], ['AO', "Angola", 'pt', 'AOA'], ['AI', "Anguilla", 'en', 'XCD'],
  ['AQ', "Antarctica", 'en', 'USD'], ['AG', "Antigua and Barbuda", 'en', 'XCD'], ['AR', "Argentina", 'es', 'ARS'], ['AM', "Armenia", 'hy', 'AMD'],
  ['AW', "Aruba", 'nl', 'AWG'], ['AU', "Australia", 'en', 'AUD'], ['AT', "Austria", 'de', 'EUR'], ['AZ', "Azerbaijan", 'az', 'AZN'],
  ['BS', "Bahamas", 'en', 'BSD'], ['BH', "Bahrain", 'ar', 'BHD'], ['BD', "Bangladesh", 'bn', 'BDT'], ['BB', "Barbados", 'en', 'BBD'],
  ['BY', "Belarus", 'be', 'BYN'], ['BE', "Belgium", 'nl', 'EUR'], ['BZ', "Belize", 'en', 'BZD'], ['BJ', "Benin", 'fr', 'XOF'],
  ['BM', "Bermuda", 'en', 'BMD'], ['BT', "Bhutan", 'dz', 'BTN'], ['BO', "Bolivia", 'es', 'BOB'], ['BA', "Bosnia and Herzegovina", 'bs', 'BAM'],
  ['BW', "Botswana", 'en', 'BWP'], ['BV', "Bouvet Island", 'no', 'NOK'], ['BR', "Brazil", 'pt', 'BRL'],
  ['IO', "British Indian Ocean Territory", 'en', 'USD'], ['VG', "British Virgin Islands", 'en', 'USD'], ['BN', "Brunei", 'ms', 'BND'],
  ['BG', "Bulgaria", 'bg', 'BGN'], ['BF', "Burkina Faso", 'fr', 'XOF'], ['BI', "Burundi", 'fr', 'BIF'], ['KH', "Cambodia", 'km', 'KHR'],
  ['CM', "Cameroon", 'fr', 'XAF'], ['CA', "Canada", 'en', 'CAD'], ['CV', "Cape Verde", 'pt', 'CVE'], ['BQ', "Caribbean Netherlands", 'nl', 'USD'],
  ['KY', "Cayman Islands", 'en', 'KYD'], ['CF', "Central African Republic", 'fr', 'XAF'], ['TD', "Chad", 'fr', 'XAF'], ['CL', "Chile", 'es', 'CLP'],
  ['CN', "China", 'zh', 'CNY'], ['CX', "Christmas Island", 'en', 'AUD'], ['CC', "Cocos (Keeling) Islands", 'en', 'AUD'],
  ['CO', "Colombia", 'es', 'COP'], ['KM', "Comoros", 'ar', 'KMF'], ['CG', "Congo - Brazzaville", 'fr', 'XAF'],
  ['CD', "Congo - Kinshasa", 'fr', 'CDF'], ['CK', "Cook Islands", 'en', 'NZD'], ['CR', "Costa Rica", 'es', 'CRC'],
  ['CI', "Côte d'Ivoire", 'fr', 'XOF'], ['HR', "Croatia", 'hr', 'EUR'], ['CU', "Cuba", 'es', 'CUP'], ['CW', "Curaçao", 'nl', 'ANG'],
  ['CY', "Cyprus", 'el', 'EUR'], ['CZ', "Czech Republic (Czechia)", 'cs', 'CZK'], ['DK', "Denmark", 'da', 'DKK'], ['DJ', "Djibouti", 'fr', 'DJF'],
  ['DM', "Dominica", 'en', 'XCD'], ['DO', "Dominican Republic", 'es', 'DOP'], ['EC', "Ecuador", 'es', 'USD'], ['EG', "Egypt", 'ar', 'EGP'],
  ['SV', "El Salvador", 'es', 'USD'], ['GQ', "Equatorial Guinea", 'es', 'XAF'], ['ER', "Eritrea", 'ti', 'ERN'], ['EE', "Estonia", 'et', 'EUR'],
  ['SZ', "Eswatini", 'en', 'SZL'], ['ET', "Ethiopia", 'am', 'ETB'], ['FK', "Falkland Islands", 'en', 'FKP'], ['FO', "Faroe Islands", 'fo', 'DKK'],
  ['FJ', "Fiji", 'en', 'FJD'], ['FI', "Finland", 'fi', 'EUR'], ['FR', "France", 'fr', 'EUR'], ['GF', "French Guiana", 'fr', 'EUR'],
  ['PF', "French Polynesia", 'fr', 'XPF'], ['TF', "French Southern Territories", 'fr', 'EUR'], ['GA', "Gabon", 'fr', 'XAF'],
  ['GM', "Gambia", 'en', 'GMD'], ['GE', "Georgia", 'ka', 'GEL'], ['DE', "Germany", 'de', 'EUR'], ['GH', "Ghana", 'en', 'GHS'],
  ['GI', "Gibraltar", 'en', 'GIP'], ['GR', "Greece", 'el', 'EUR'], ['GL', "Greenland", 'kl', 'DKK'], ['GD', "Grenada", 'en', 'XCD'],
  ['GP', "Guadeloupe", 'fr', 'EUR'], ['GU', "Guam", 'en', 'USD'], ['GT', "Guatemala", 'es', 'GTQ'], ['GG', "Guernsey", 'en', 'GBP'],
  ['GN', "Guinea", 'fr', 'GNF'], ['GW', "Guinea-Bissau", 'pt', 'XOF'], ['GY', "Guyana", 'en', 'GYD'], ['HT', "Haiti", 'fr', 'HTG'],
  ['HM', "Heard and McDonald Islands", 'en', 'AUD'], ['HN', "Honduras", 'es', 'HNL'], ['HK', "Hong Kong", 'zh', 'HKD'],
  ['HU', "Hungary", 'hu', 'HUF'], ['IS', "Iceland", 'is', 'ISK'], ['IN', "India", 'en', 'INR'], ['ID', "Indonesia", 'id', 'IDR'],
  ['IR', "Iran", 'fa', 'IRR'], ['IQ', "Iraq", 'ar', 'IQD'], ['IE', "Ireland", 'en', 'EUR'], ['IM', "Isle of Man", 'en', 'GBP'],
  ['IL', "Israel", 'he', 'ILS'], ['IT', "Italy", 'it', 'EUR'], ['JM', "Jamaica", 'en', 'JMD'], ['JP', "Japan", 'ja', 'JPY'],
  ['JE', "Jersey", 'en', 'GBP'], ['JO', "Jordan", 'ar', 'JOD'], ['KZ', "Kazakhstan", 'kk', 'KZT'], ['KE', "Kenya", 'en', 'KES'],
  ['KI', "Kiribati", 'en', 'AUD'], ['XK', "Kosovo", 'sq', 'EUR'], ['KW', "Kuwait", 'ar', 'KWD'], ['KG', "Kyrgyzstan", 'ky', 'KGS'],
  ['LA', "Laos", 'lo', 'LAK'], ['LV', "Latvia", 'lv', 'EUR'], ['LB', "Lebanon", 'ar', 'LBP'], ['LS', "Lesotho", 'en', 'LSL'],
  ['LR', "Liberia", 'en', 'LRD'], ['LY', "Libya", 'ar', 'LYD'], ['LI', "Liechtenstein", 'de', 'CHF'], ['LT', "Lithuania", 'lt', 'EUR'],
  ['LU', "Luxembourg", 'fr', 'EUR'], ['MO', "Macao", 'zh', 'MOP'], ['MG', "Madagascar", 'mg', 'MGA'], ['MW', "Malawi", 'en', 'MWK'],
  ['MY', "Malaysia", 'ms', 'MYR'], ['MV', "Maldives", 'dv', 'MVR'], ['ML', "Mali", 'fr', 'XOF'], ['MT', "Malta", 'mt', 'EUR'],
  ['MH', "Marshall Islands", 'en', 'USD'], ['MQ', "Martinique", 'fr', 'EUR'], ['MR', "Mauritania", 'ar', 'MRU'], ['MU', "Mauritius", 'en', 'MUR'],
  ['YT', "Mayotte", 'fr', 'EUR'], ['MX', "Mexico", 'es', 'MXN'], ['FM', "Micronesia", 'en', 'USD'], ['MD', "Moldova", 'ro', 'MDL'],
  ['MC', "Monaco", 'fr', 'EUR'], ['MN', "Mongolia", 'mn', 'MNT'], ['ME', "Montenegro", 'sr', 'EUR'], ['MS', "Montserrat", 'en', 'XCD'],
  ['MA', "Morocco", 'ar', 'MAD'], ['MZ', "Mozambique", 'pt', 'MZN'], ['MM', "Myanmar (Burma)", 'my', 'MMK'], ['NA', "Namibia", 'en', 'NAD'],
  ['NR', "Nauru", 'en', 'AUD'], ['NP', "Nepal", 'ne', 'NPR'], ['NL', "Netherlands", 'nl', 'EUR'], ['NC', "New Caledonia", 'fr', 'XPF'],
  ['NZ', "New Zealand", 'en', 'NZD'], ['NI', "Nicaragua", 'es', 'NIO'], ['NE', "Niger", 'fr', 'XOF'], ['NG', "Nigeria", 'en', 'NGN'],
  ['NU', "Niue", 'en', 'NZD'], ['NF', "Norfolk Island", 'en', 'AUD'], ['KP', "North Korea", 'ko', 'KPW'], ['MK', "North Macedonia", 'mk', 'MKD'],
  ['MP', "Northern Mariana Islands", 'en', 'USD'], ['NO', "Norway", 'no', 'NOK'], ['OM', "Oman", 'ar', 'OMR'], ['PK', "Pakistan", 'ur', 'PKR'],
  ['PW', "Palau", 'en', 'USD'], ['PS', "Palestinian Territories", 'ar', 'ILS'], ['PA', "Panama", 'es', 'PAB'],
  ['PG', "Papua New Guinea", 'en', 'PGK'], ['PY', "Paraguay", 'es', 'PYG'], ['PE', "Peru", 'es', 'PEN'], ['PH', "Philippines", 'en', 'PHP'],
  ['PN', "Pitcairn Islands", 'en', 'NZD'], ['PL', "Poland", 'pl', 'PLN'], ['PT', "Portugal", 'pt', 'EUR'], ['PR', "Puerto Rico", 'es', 'USD'],
  ['QA', "Qatar", 'ar', 'QAR'], ['RE', "Réunion", 'fr', 'EUR'], ['RO', "Romania", 'ro', 'RON'], ['RU', "Russia", 'ru', 'RUB'],
  ['RW', "Rwanda", 'rw', 'RWF'], ['WS', "Samoa", 'en', 'WST'], ['SM', "San Marino", 'it', 'EUR'], ['ST', "São Tomé and Príncipe", 'pt', 'STN'],
  ['SA', "Saudi Arabia", 'ar', 'SAR'], ['SN', "Senegal", 'fr', 'XOF'], ['RS', "Serbia", 'sr', 'RSD'], ['SC', "Seychelles", 'en', 'SCR'],
  ['SL', "Sierra Leone", 'en', 'SLE'], ['SG', "Singapore", 'en', 'SGD'], ['SX', "Sint Maarten", 'nl', 'ANG'], ['SK', "Slovakia", 'sk', 'EUR'],
  ['SI', "Slovenia", 'sl', 'EUR'], ['SB', "Solomon Islands", 'en', 'SBD'], ['SO', "Somalia", 'so', 'SOS'], ['ZA', "South Africa", 'en', 'ZAR'],
  ['GS', "South Georgia and South Sandwich Islands", 'en', 'GBP'], ['KR', "South Korea", 'ko', 'KRW'], ['SS', "South Sudan", 'en', 'SSP'],
  ['ES', "Spain", 'es', 'EUR'], ['LK', "Sri Lanka", 'si', 'LKR'], ['BL', "St. Barthélemy", 'fr', 'EUR'], ['SH', "St. Helena", 'en', 'SHP'],
  ['KN', "St. Kitts and Nevis", 'en', 'XCD'], ['LC', "St. Lucia", 'en', 'XCD'], ['MF', "St. Martin", 'fr', 'EUR'],
  ['PM', "St. Pierre and Miquelon", 'fr', 'EUR'], ['VC', "St. Vincent and Grenadines", 'en', 'XCD'], ['SD', "Sudan", 'ar', 'SDG'],
  ['SR', "Suriname", 'nl', 'SRD'], ['SJ', "Svalbard and Jan Mayen", 'no', 'NOK'], ['SE', "Sweden", 'sv', 'SEK'], ['CH', "Switzerland", 'de', 'CHF'],
  ['SY', "Syria", 'ar', 'SYP'], ['TW', "Taiwan", 'zh', 'TWD'], ['TJ', "Tajikistan", 'tg', 'TJS'], ['TZ', "Tanzania", 'sw', 'TZS'],
  ['TH', "Thailand", 'th', 'THB'], ['TL', "Timor-Leste", 'pt', 'USD'], ['TG', "Togo", 'fr', 'XOF'], ['TK', "Tokelau", 'en', 'NZD'],
  ['TO', "Tonga", 'en', 'TOP'], ['TT', "Trinidad and Tobago", 'en', 'TTD'], ['TN', "Tunisia", 'ar', 'TND'], ['TR', "Turkey (Türkiye)", 'tr', 'TRY'],
  ['TM', "Turkmenistan", 'tk', 'TMT'], ['TC', "Turks and Caicos Islands", 'en', 'USD'], ['TV', "Tuvalu", 'en', 'AUD'],
  ['UM', "U.S. Outlying Islands", 'en', 'USD'], ['VI', "U.S. Virgin Islands", 'en', 'USD'], ['UG', "Uganda", 'en', 'UGX'],
  ['UA', "Ukraine", 'uk', 'UAH'], ['AE', "United Arab Emirates", 'ar', 'AED'], ['GB', "United Kingdom", 'en', 'GBP'],
  ['US', "United States", 'en', 'USD'], ['UY', "Uruguay", 'es', 'UYU'], ['UZ', "Uzbekistan", 'uz', 'UZS'], ['VU', "Vanuatu", 'en', 'VUV'],
  ['VA', "Vatican City", 'it', 'EUR'], ['VE', "Venezuela", 'es', 'VES'], ['VN', "Vietnam", 'vi', 'VND'], ['WF', "Wallis and Futuna", 'fr', 'XPF'],
  ['EH', "Western Sahara", 'ar', 'MAD'], ['YE', "Yemen", 'ar', 'YER'], ['ZM', "Zambia", 'en', 'ZMW'], ['ZW', "Zimbabwe", 'en', 'USD'],
] as const).map(([code, name, lang, currency]) => ({ code, name, lang, currency }));

/** Other names people type when they search for a country. */
export const COUNTRY_ALIASES: Record<string, string> = {
  GB: 'UK Britain England Scotland Wales', US: 'USA America', AE: 'UAE Emirates Dubai', KR: 'Korea', KP: 'Korea', CZ: 'Czechia', TR: 'Turkiye',
  NL: 'Holland', CI: 'Ivory Coast', MM: 'Burma', RU: 'Russia', VN: 'Viet Nam', CD: 'DRC Congo', CG: 'Congo', SZ: 'Swaziland', MK: 'Macedonia',
};

export const countryName = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

/** The flag emoji for a country code. Windows has no flag emoji, so globals.css ships a flag font for them. */
export function flag(code: string) {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
