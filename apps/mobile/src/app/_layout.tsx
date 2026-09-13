import { Slot } from 'expo-router';
import { ThemeProvider } from '@fp/ui';

/**
 * Theme resolution happens once, here, at the root (FR-003) — nothing
 * beneath this reads or branches on light versus dark. `Slot` renders
 * whichever route matched; the five destinations live under `(tabs)`.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <Slot />
    </ThemeProvider>
  );
}
