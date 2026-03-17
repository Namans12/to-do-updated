# Native Wrapper Plan

This project keeps the current `frontend` as the single MVP UI source of truth.

## Targets

- Web/PWA: existing Vite frontend
- Desktop: Tauri wrapper around the same frontend
- Android: Capacitor wrapper around the same frontend

## Commands

From `frontend/`:

- Web dev: `npm run dev`
- Web build: `npm run build:web`
- Desktop dev: `npm run desktop:dev`
- Desktop check: `npm run desktop:check`
- Desktop build: `npm run desktop:build`
- Android sync: `npm run android:sync`
- Android open: `npm run android:open`
- Android build: `npm run android:build`

## Notes

- The current app UI is intentionally reused exactly.
- Shared sync/auth stays in Supabase.
- Platform-specific optimization should happen after wrapper stability is verified.
- Tauri bundle packaging is intentionally disabled for the first pass to avoid blocking on native icon generation.

## Native auth redirect

If you use Supabase magic-link auth inside the Android wrapper, add this redirect URL in Supabase Auth URL configuration:

- `com.namans.todo://auth/callback`

The wrapped app now listens for that deep link and restores the Supabase session inside the native shell.
