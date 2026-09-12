/**
 * A single flat, tinted placeholder block — the one shape every row's
 * loading form is built from (FR-020, artboard 07: "surface.sunken blocks
 * at the real row anatomy, no spinner, no shimmer").
 */
import { View } from 'react-native';
import { radius } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';

export interface SkeletonBlockProps {
  readonly width: number | `${number}%`;
  readonly height: number;
  /** @default radius.xs */
  readonly rounded?: number;
}

export function SkeletonBlock({ width, height, rounded = radius.xs }: SkeletonBlockProps) {
  const { colours } = useTheme();
  return (
    <View
      style={{ width, height, borderRadius: rounded, backgroundColor: colours['surface.sunken'] }}
    />
  );
}
