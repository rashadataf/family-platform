/**
 * A labelled block in the gallery (T050/T051) — a name matching the canvas's
 * own wording, an optional note, and its states. Not a `@fp/ui` primitive:
 * this is scaffolding for the gallery screen alone, not a product surface.
 */
import { Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { space, typography, useTheme } from '@fp/ui';

export interface GallerySectionProps {
  readonly title: string;
  readonly note?: string;
  readonly children?: ReactNode;
}

export function GallerySection({ title, note, children }: GallerySectionProps) {
  const { colours } = useTheme();

  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text
          style={{
            fontSize: typography['title.lg'].size,
            lineHeight: typography['title.lg'].lineHeight,
            fontWeight: typography['title.lg'].weight,
            color: colours['text.primary'],
          }}
        >
          {title}
        </Text>
        {note !== undefined ? (
          <Text
            style={{
              fontSize: typography['body.sm'].size,
              lineHeight: typography['body.sm'].lineHeight,
              fontWeight: typography['body.sm'].weight,
              color: colours['text.secondary'],
            }}
          >
            {note}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: space[3] }}>{children}</View>
    </View>
  );
}

export interface GalleryStateProps {
  readonly label: string;
  readonly children?: ReactNode;
}

/** One named state within a section — labelled with the canvas's own term for it. */
export function GalleryState({ label, children }: GalleryStateProps) {
  const { colours } = useTheme();

  return (
    <View style={{ gap: space[2] }}>
      <Text
        style={{
          fontSize: typography.caption.size,
          lineHeight: typography.caption.lineHeight,
          fontWeight: typography.caption.weight,
          color: colours['text.tertiary'],
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}
