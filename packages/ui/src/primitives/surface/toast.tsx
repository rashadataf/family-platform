/**
 * Toast (artboard 07): surface.inverse, sits above the tab bar, one
 * message, at most one action. "Never blocks" is an integration
 * responsibility (an overlay, not a modal) that this component cannot
 * enforce by itself — it renders; where it is mounted is what keeps it
 * non-blocking.
 *
 * surface.inverse and text.inverse are the one pairing on the canvas that
 * flips OPPOSITE to the app's own theme by design, so a toast reads the
 * same dark-on-light-app / light-on-dark-app either way. The action label
 * uses that same text.inverse pairing rather than the canvas's literal
 * accent hex (#E0A077, unverified against this exact background in either
 * theme) — weight and an underline carry the distinction instead.
 */
import { Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { elevation, radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { elevationToShadowStyle } from '../../internal/elevation-style.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';

export interface ToastProps {
  readonly icon: ReactElement;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function Toast({ icon, message, actionLabel, onAction }: ToastProps) {
  const { colours } = useTheme();
  const shadow = elevationToShadowStyle('3', elevation['3']);
  // The canvas draws this message at 14/20, which is not a step in the type
  // scale (FR-009) — body.sm (13/19) is the closest real one.
  const messageStyle = typeStepToTextStyle(typography['body.sm']);
  const actionStyle = typeStepToTextStyle(typography['label.sm']);

  return (
    <View style={shadow}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space[3],
          padding: space[4],
          borderRadius: radius.md,
          backgroundColor: colours['surface.inverse'],
        }}
      >
        {icon}
        <Text style={[messageStyle, { color: colours['text.inverse'], flexGrow: 1 }]}>
          {message}
        </Text>
        {actionLabel !== undefined && (
          <Text
            onPress={onAction}
            accessibilityRole="button"
            style={[
              actionStyle,
              { color: colours['text.inverse'], textDecorationLine: 'underline' },
            ]}
          >
            {actionLabel}
          </Text>
        )}
      </View>
    </View>
  );
}
