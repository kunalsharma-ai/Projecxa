# Interface languages

Staff screens, the client and vendor portals, and the sign-in pages can be shown in English, Hindi (हिन्दी) or Spanish (Español). The respondent pages have their own languages, set per project, and are not covered here.

## For people using SampTrek

- Choose a language from the language button (文A) in the top bar, or in the top corner of the sign-in page.
- The choice is personal. It is saved on your profile, so it follows you to any device, and it does not change what anyone else sees.
- "Reset look" in Theme Studio keeps your language.
- Words that are not translated yet stay in English. Names, codes, emails and other typed data are never translated.

## How it works

English text in the code is the source and the key. Each language has two dictionaries that map the English text, exactly as it appears on screen, to its translation:

```
apps/web/lib/locales/<lang>/ui.json    buttons, labels, headings, messages
apps/web/lib/locales/<lang>/help.json  the "i" help cards (lib/help.ts)
```

`components/i18n.tsx` loads the dictionaries only when a language other than English is picked. After React draws, a page translator swaps text and the `placeholder`, `title`, `aria-label` and `alt` attributes for their translation. It remembers the English original, so switching back to English, or React changing the text, always starts again from English.

- Keys may hold numbered gaps: `"About {0}"`, `"{0} new"`. The gap matches any text and that text is itself translated when it is known.
- A trailing `…`, `:`, `*`, `›`, `→` or `.` is translated without it and then put back, so `"Name"` also covers `"Name:"`.
- For strings built in code (document title, confirm boxes, text with numbers) use `const t = useT(); t('Delete {name}?', { name })`.

## Rules for new screens

1. Write the English text as usual. Nothing breaks if a translation is missing.
2. Mark anything that must never be translated (people's names, project codes, emails, typed data) with `translate="no"` or `data-no-translate`. Text areas, `code` and `pre` are skipped already.
3. Add the new strings to `lib/locales/hi/ui.json` and `lib/locales/es/ui.json`, and help card text to `help.json`, when you can.

`pnpm --filter @projexa/web test` runs `scripts/check-i18n.ts`. It fails only on broken entries (an empty translation, or one that drops or adds a `{placeholder}`), and prints how much of the help text is covered. `pnpm --filter @projexa/web check:i18n` also lists the untranslated help text.

## Adding a language

1. Add it to `LANGUAGES` in `apps/web/lib/i18n.ts`, to `LANGUAGE_IDS` in `apps/api/src/auth/preferences.ts`, and to the `language` type in `apps/web/lib/theme.ts`.
2. Copy `lib/locales/es/` to `lib/locales/<id>/` and translate the values.

Country names, currency names and font names stay in English for now.
