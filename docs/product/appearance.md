# Appearance

### appearance.app-icon-theme · presentation · accepted

The native Home Screen icon follows the theme applied at launch. Warm, Slate,
Forest and Plum each have their own icon, with three stripe shades. Warm is the
default icon and the fallback for every custom colour, an unknown saved theme,
or an unreadable theme choice. Changing the saved choice changes the icon at
the next launch, alongside the app theme.

Why: every preset has matching artwork; one bundled fallback covers colours
without their own icon. Approved 2026-10-15.
Code: `apps/mobile/components/appearance/theme-app-icon.ts`; `apps/mobile/app.config.ts`.
