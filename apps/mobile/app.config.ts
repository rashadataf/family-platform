import type { ExpoConfig } from 'expo/config';

/**
 * TypeScript over app.json (the Expo template's default): this repository is
 * TypeScript end to end, and a dynamic config is what will let a later spec
 * vary anything here per environment without a second config format.
 *
 * Minimal on purpose (spec 007 scope, ADR-016): no icons, no splash screen,
 * no plugins beyond expo-router. Product-level app identity is a later
 * feature's concern, not this one's.
 */
const config: ExpoConfig = {
  name: 'Family Platform',
  slug: 'family-platform',
  scheme: 'familyplatform',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
