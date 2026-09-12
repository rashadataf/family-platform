/**
 * Header (artboard 08): compact (56px, centred title, one optional back and
 * at most one action — "never more than one action") or large (a display
 * title that collapses to compact on scroll — this component renders the
 * expanded form only; the scroll-driven collapse is a screen's own
 * animation, not something a header component can own by itself).
 */
import { Pressable, Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';

export interface HeaderAction {
  readonly icon: ReactElement;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
}

interface HeaderBaseProps {
  readonly onBack?: () => void;
  /** At most one — the type has room for exactly one, not a list. */
  readonly action?: HeaderAction;
}

export interface CompactHeaderProps extends HeaderBaseProps {
  readonly variant?: 'compact';
  readonly title: string;
}

export interface LargeHeaderProps extends HeaderBaseProps {
  readonly variant: 'large';
  readonly title: string;
  readonly subtitle?: string;
}

export type HeaderProps = CompactHeaderProps | LargeHeaderProps;

const SLOT_SIZE = 40;

function IconSlot({
  action,
  onBack,
}: {
  readonly action?: HeaderAction;
  readonly onBack?: () => void;
}) {
  const { colours } = useTheme();
  if (onBack !== undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={{
          width: SLOT_SIZE,
          height: SLOT_SIZE,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colours['text.primary'], fontSize: 20 }}>‹</Text>
      </Pressable>
    );
  }
  if (action !== undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel}
        onPress={action.onPress}
        style={{
          width: SLOT_SIZE,
          height: SLOT_SIZE,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {action.icon}
      </Pressable>
    );
  }
  return <View style={{ width: SLOT_SIZE, height: SLOT_SIZE }} />;
}

export function Header(props: HeaderProps) {
  const { colours } = useTheme();
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const largeTitleStyle = typeStepToTextStyle(typography['display.lg']);
  const subtitleStyle = typeStepToTextStyle(typography['body.sm']);

  if (props.variant === 'large') {
    return (
      <View
        style={{
          gap: space[1],
          paddingTop: space[3],
          paddingBottom: space[4],
          paddingHorizontal: space[6],
          backgroundColor: colours['surface.canvas'],
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: SLOT_SIZE,
          }}
        >
          <IconSlot onBack={props.onBack} />
          <IconSlot action={props.action} />
        </View>
        <Text style={[largeTitleStyle, { color: colours['text.primary'] }]}>{props.title}</Text>
        {props.subtitle !== undefined && (
          <Text style={[subtitleStyle, { color: colours['text.secondary'] }]}>
            {props.subtitle}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        paddingHorizontal: space[3],
        backgroundColor: colours['surface.raised'],
        borderBottomWidth: 1,
        borderColor: colours['border.subtle'],
      }}
    >
      <IconSlot onBack={props.onBack} />
      <Text style={[titleStyle, { color: colours['text.primary'] }]}>{props.title}</Text>
      <IconSlot action={props.action} />
    </View>
  );
}
