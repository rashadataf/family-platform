/**
 * Empty state (artboard 07): icon, one line of what, one line of why, one
 * action. Exactly that shape, not a general-purpose "message box" — a
 * fourth line or a second action is a different component, not a variant
 * of this one.
 */
import { Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';
import { Card } from './card.js';
import type { ButtonProps } from '../button/button.js';

export interface EmptyStateProps {
  readonly icon: ReactElement;
  readonly title: string;
  readonly description: string;
  /** The one action artboard 07 draws — typically a primary Button. */
  readonly action: ReactElement<ButtonProps>;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const { colours } = useTheme();
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  // The canvas draws this description at 14/20, which is not a step in the
  // type scale (FR-009) — body.sm (13/19) is the closest real one, and this
  // is recorded as a canvas correction alongside the others from this board.
  const descriptionStyle = typeStepToTextStyle(typography['body.sm']);

  return (
    <Card>
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[4],
          // The canvas draws asymmetric 32/28 padding here; 28 is not on the
          // scale (FR-009), so this is one uniform space.7 — another of this
          // board's canvas corrections.
          padding: space[7],
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.full,
            backgroundColor: colours['surface.sunken'],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <View style={{ alignItems: 'center', gap: space[2] }}>
          <Text style={[titleStyle, { color: colours['text.primary'] }]}>{title}</Text>
          <Text
            style={[descriptionStyle, { color: colours['text.secondary'], textAlign: 'center' }]}
          >
            {description}
          </Text>
        </View>
        {action}
      </View>
    </Card>
  );
}
