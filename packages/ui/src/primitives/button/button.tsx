/**
 * Button (artboard 05). Five variants, five states, three heights — every
 * button in the product is one cell of this grid.
 *
 * FR-014, width unchanged between states: every variant always renders a
 * 1px border, coloured `transparent` where the artboard draws none. Removing
 * the border for disabled/quiet/ghost/primary/destructive instead of just
 * making it invisible would shrink the box by 2px the moment a button
 * becomes disabled — the loading spinner replacing the icon (rather than the
 * icon disappearing) is the same rule applied to the other axis.
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  type GestureResponderEvent,
  type TextStyle,
} from 'react-native';
import {
  radius,
  space,
  typography,
  type Radius,
  type Space,
  type TypeStep,
} from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface SizeSpec {
  readonly height: number;
  readonly paddingHorizontal: Space;
  readonly gap: Space;
  readonly radius: Radius;
  readonly iconSize: number;
  readonly label: TypeStep;
}

const SIZES: Record<ButtonSize, SizeSpec> = {
  lg: {
    height: 56,
    paddingHorizontal: space[6],
    gap: space[2],
    radius: radius.md,
    iconSize: 20,
    label: typography['label.lg'],
  },
  md: {
    height: 48,
    paddingHorizontal: space[5],
    gap: space[2],
    radius: radius.md,
    iconSize: 20,
    label: typography['label.lg'],
  },
  sm: {
    height: 40,
    paddingHorizontal: space[4],
    gap: space[2],
    radius: radius.sm,
    iconSize: 16,
    label: typography['label.sm'],
  },
};

interface ButtonBaseProps {
  readonly variant: ButtonVariant;
  /** @default 'md' */
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** The lg/phone pattern (artboard 05, "Full width"): stretches to its container. */
  readonly fullWidth?: boolean;
  readonly onPress: (event: GestureResponderEvent) => void;
}

interface ButtonLabelledProps extends ButtonBaseProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly iconOnly?: false;
  readonly accessibilityLabel?: string;
}

interface ButtonIconOnlyProps extends ButtonBaseProps {
  readonly icon: ReactNode;
  readonly iconOnly: true;
  readonly label?: undefined;
  /**
   * Required, not optional, when there is no visible label — the anatomy
   * note on artboard 05 is "always labelled to a screen reader", and an
   * icon-only button that compiles without one is exactly what this type
   * exists to make impossible.
   */
  readonly accessibilityLabel: string;
}

export type ButtonProps = ButtonLabelledProps | ButtonIconOnlyProps;

interface VisualState {
  readonly background: string;
  readonly foreground: string;
  readonly borderColor: string;
}

function useVariantStates(variant: ButtonVariant): {
  default: VisualState;
  pressed: VisualState;
  disabled: VisualState;
} {
  const { colours } = useTheme();
  const transparent = 'transparent';

  switch (variant) {
    case 'primary':
      return {
        default: {
          background: colours['action.primary'],
          foreground: colours['text.onAction'],
          borderColor: transparent,
        },
        pressed: {
          background: colours['action.primaryPressed'],
          foreground: colours['text.onAction'],
          borderColor: transparent,
        },
        disabled: {
          background: colours['action.disabledBg'],
          foreground: colours['action.disabledFg'],
          borderColor: transparent,
        },
      };
    case 'secondary':
      return {
        default: {
          background: colours['surface.raised'],
          foreground: colours['text.primary'],
          borderColor: colours['border.strong'],
        },
        pressed: {
          background: colours['action.quiet'],
          foreground: colours['text.primary'],
          borderColor: colours['border.strong'],
        },
        disabled: {
          background: colours['action.disabledBg'],
          foreground: colours['action.disabledFg'],
          borderColor: transparent,
        },
      };
    case 'quiet':
      return {
        default: {
          background: colours['action.quiet'],
          foreground: colours['text.primary'],
          borderColor: transparent,
        },
        pressed: {
          background: colours['border.subtle'],
          foreground: colours['text.primary'],
          borderColor: transparent,
        },
        disabled: {
          background: colours['action.disabledBg'],
          foreground: colours['action.disabledFg'],
          borderColor: transparent,
        },
      };
    case 'ghost':
      return {
        default: {
          background: transparent,
          foreground: colours['text.link'],
          borderColor: transparent,
        },
        pressed: {
          background: colours['action.quiet'],
          foreground: colours['text.link'],
          borderColor: transparent,
        },
        disabled: {
          background: colours['action.disabledBg'],
          foreground: colours['action.disabledFg'],
          borderColor: transparent,
        },
      };
    case 'destructive':
      return {
        default: {
          background: colours['action.destructive'],
          foreground: colours['text.onAction'],
          borderColor: transparent,
        },
        pressed: {
          background: colours['action.destructivePressed'],
          foreground: colours['text.onAction'],
          borderColor: transparent,
        },
        disabled: {
          background: colours['action.disabledBg'],
          foreground: colours['action.disabledFg'],
          borderColor: transparent,
        },
      };
  }
}

export function Button(props: ButtonProps) {
  const {
    variant,
    size = 'md',
    disabled = false,
    loading = false,
    fullWidth = false,
    onPress,
  } = props;
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const { colours } = useTheme();
  const states = useVariantStates(variant);
  const spec = SIZES[size];

  const isInactive = disabled || loading;
  const visual =
    isInactive && disabled ? states.disabled : pressed ? states.pressed : states.default;
  const labelStyle = typeStepToTextStyle(spec.label);
  const textStyle: TextStyle = { ...labelStyle, color: visual.foreground };

  const squareSide = props.iconOnly ? spec.height : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      accessibilityLabel={props.accessibilityLabel}
      disabled={isInactive}
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
      }}
      onPressOut={() => {
        setPressed(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        height: spec.height,
        width: squareSide,
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spec.gap,
        paddingHorizontal: props.iconOnly ? 0 : spec.paddingHorizontal,
        borderRadius: spec.radius,
        backgroundColor: visual.background,
        borderWidth: 1,
        borderColor: visual.borderColor,
        // Outline, not border: it sits outside the box model (like the
        // artboard's CSS `outline`), so focus never resizes the button.
        outlineWidth: focused && !isInactive ? 2 : 0,
        outlineColor: colours['border.focus'],
        outlineOffset: 2,
        outlineStyle: 'solid',
      }}
    >
      {loading ? (
        // React Native's ActivityIndicator has two fixed sizes, not an
        // arbitrary pixel size — 'small' is the nearer fit to both the 20px
        // and 16px icon slots it replaces (FR-014: the icon slot, not the
        // button, is what changes on loading).
        <ActivityIndicator size="small" color={visual.foreground} />
      ) : (
        props.icon
      )}
      {!props.iconOnly && <Text style={textStyle}>{props.label}</Text>}
    </Pressable>
  );
}
