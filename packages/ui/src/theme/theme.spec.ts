import { describe, expect, it } from 'vitest';
import { parseStoredThemePreference, resolveThemePreference } from './resolve-theme-preference.js';

describe('resolveThemePreference', () => {
  it('follows the OS scheme when the preference is system', () => {
    expect(resolveThemePreference('system', 'dark')).toBe('dark');
    expect(resolveThemePreference('system', 'light')).toBe('light');
  });

  it('an explicit override wins over the OS scheme', () => {
    expect(resolveThemePreference('light', 'dark')).toBe('light');
    expect(resolveThemePreference('dark', 'light')).toBe('dark');
  });
});

describe('parseStoredThemePreference', () => {
  it('falls back to system when nothing is stored', () => {
    expect(parseStoredThemePreference(null)).toBe('system');
  });

  it('falls back to system for a value it does not recognise', () => {
    expect(parseStoredThemePreference('sepia')).toBe('system');
  });

  it('accepts each valid stored preference as-is', () => {
    expect(parseStoredThemePreference('system')).toBe('system');
    expect(parseStoredThemePreference('light')).toBe('light');
    expect(parseStoredThemePreference('dark')).toBe('dark');
  });
});
