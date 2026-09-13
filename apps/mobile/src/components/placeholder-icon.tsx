/**
 * A placeholder for every icon apps/mobile needs and no SVG icon library
 * exists to draw yet — ADR-016 scoped spec 007 to tokens and primitives,
 * not an icon set, and each of Button, TaskRow and DocumentRow already
 * noted the same gap where it first mattered. This is not a design
 * decision to keep; it is the one place that decision is deferred to.
 */
import { Text } from 'react-native';
import { useTheme } from '@fp/ui';

export interface PlaceholderIconProps {
  readonly glyph: string;
  readonly active?: boolean;
}

export function PlaceholderIcon({ glyph, active = false }: PlaceholderIconProps) {
  const { colours } = useTheme();
  return (
    <Text
      style={{
        fontSize: 20,
        lineHeight: 24,
        color: active ? colours['action.primary'] : colours['text.tertiary'],
      }}
    >
      {glyph}
    </Text>
  );
}
