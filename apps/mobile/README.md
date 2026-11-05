# PROJEXA mobile (Android + iOS)

Expo / React Native app. Full guide, feature list and the Super Admin feature-switch contract: [docs/MOBILE_APP.md](../../docs/MOBILE_APP.md).

```bash
npm install
EXPO_PUBLIC_API_URL=http://<api-host>:4000 npx expo start
npm run typecheck && npm test
```

- Screens: `src/app` (Expo Router; every file is a screen). Shared UI: `src/components`. API client, session, feature switches, theme: `src/lib`.
- Uses npm (not pnpm); it is excluded from the pnpm workspace.
