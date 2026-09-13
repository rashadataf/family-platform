/**
 * LayoutGrid (artboard 04): the only thing that changes between a phone and
 * a desktop. Colour, type, spacing, radius and elevation are identical on
 * both — this container applies the one axis that legitimately varies by
 * breakpoint, the horizontal margin, so a screen built from tokens and
 * primitives needs no breakpoint conditional of its own to sit correctly at
 * every width.
 *
 * Deliberately Flexbox only, per the canvas's own platform-parity table:
 * "Flexbox is the shared subset. No CSS grid in a shared component; grid is
 * web-only composition." `columns` and `gutter` are exposed through
 * `useBreakpoint` for that web-only composition to use; this component does
 * not draw column tracks itself.
 */
import { View } from 'react-native';
import type { ReactNode } from 'react';
import { useBreakpoint } from './use-breakpoint.js';

export interface LayoutGridProps {
  readonly children?: ReactNode;
}

export function LayoutGrid({ children }: LayoutGridProps) {
  const breakpoint = useBreakpoint();

  return <View style={{ flex: 1, paddingHorizontal: breakpoint.margin }}>{children}</View>;
}
