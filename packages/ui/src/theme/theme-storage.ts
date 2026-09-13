/**
 * Device-local persistence for the theme preference (FR-005). Thin I/O
 * only — the parsing of what comes back lives in the pure
 * `resolve-theme-preference.ts` so it can be unit-tested; this file just
 * moves bytes and is not, consistent with R13 (it reaches `react-native`
 * through `@react-native-async-storage/async-storage`).
 */
import * as AsyncStorageModule from '@react-native-async-storage/async-storage';
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';
import { parseStoredThemePreference, type ThemePreference } from './resolve-theme-preference.js';

/**
 * Verified (by comparing `moduleResolution: NodeNext` against `node` and
 * `bundler` on this exact import in isolation) that only `NodeNext` — this
 * repo's setting — fails to resolve this package's `export default` to
 * anything more specific than the whole module namespace, typing
 * `AsyncStorageModule.default` as `typeof import(...)` instead of
 * `AsyncStorageStatic`. The runtime value is correct regardless — Metro's
 * own bundling of this same import proves that — so this bridges a real
 * tool limitation, not a domain-logic escape hatch.
 */
const AsyncStorage = AsyncStorageModule.default as unknown as AsyncStorageStatic;

const STORAGE_KEY = '@fp/ui/theme-preference';

export async function loadThemePreference(): Promise<ThemePreference> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return parseStoredThemePreference(raw);
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, preference);
}
