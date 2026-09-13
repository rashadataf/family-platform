/**
 * Card (artboard 07's row containers, artboard 05's rules panels — the one
 * elevated container shape used throughout). Elevation 1: the same shadow
 * every row list, empty state and rules panel on the canvas draws.
 *
 * Two nested views, not one: React Native's iOS shadow is drawn on the
 * view's own layer, and `overflow: 'hidden'` on THAT SAME view clips the
 * shadow away along with the content — unlike CSS, where `box-shadow`
 * paints outside the box regardless of `overflow`. The outer view carries
 * only the shadow; the inner one carries the border, radius and clipping
 * the artboard's row dividers need.
 */
import { View, type ViewProps } from 'react-native';
import { elevation, radius } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { elevationToShadowStyle } from '../../internal/elevation-style.js';

export interface CardProps extends Pick<ViewProps, 'children'> {
  readonly style?: ViewProps['style'];
}

export function Card({ children, style }: CardProps) {
  const { colours } = useTheme();
  const shadow = elevationToShadowStyle('1', elevation['1']);

  return (
    <View style={shadow}>
      <View
        style={[
          {
            backgroundColor: colours['surface.raised'],
            borderWidth: 1,
            borderColor: colours['border.subtle'],
            borderRadius: radius.md,
            overflow: 'hidden',
          },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
