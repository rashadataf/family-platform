import { Slot } from 'expo-router';

/**
 * Deliberately minimal (T006/T007): proves the router boots. `ThemeProvider`
 * wraps this in T023 — until then there is nothing here for a screen to
 * consume, so nothing is added prematurely.
 */
export default function RootLayout() {
  return <Slot />;
}
