/**
 * Event row (artboard 07): a 50px time column, a coloured category bar, a
 * title and subtitle, and the event's participants as an avatar stack.
 *
 * The category bar's colour is not a separate choice — it is
 * `avatarColourRole` on `categoryId`, the same hash every avatar in the
 * product uses. The canvas's own example draws it that way (the bar next
 * to "Nursery pickup" is the same terracotta as the avatar for the child
 * it's for): one colour identity per person, whether shown as a bar or a
 * circle, not two systems that could drift apart.
 */
import { Text, View } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { avatarColourRole } from '../../internal/avatar-colour.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';
import { Avatar, type AvatarProps } from '../surface/avatar.js';
import { RowShell } from './row-shell.js';
import { SkeletonBlock } from './skeleton-block.js';

export interface EventRowProps {
  readonly categoryId: string;
  readonly time: string;
  readonly duration: string;
  readonly title: string;
  readonly subtitle: string;
  readonly participants: readonly Pick<AvatarProps, 'memberId' | 'initials'>[];
  readonly isLast?: boolean;
}

export function EventRow({
  categoryId,
  time,
  duration,
  title,
  subtitle,
  participants,
  isLast,
}: EventRowProps) {
  const { colours } = useTheme();
  const timeStyle = typeStepToTextStyle(typography['label.lg']);
  const durationStyle = typeStepToTextStyle(typography.caption);
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const subtitleStyle = typeStepToTextStyle(typography['body.sm']);

  return (
    <RowShell isLast={isLast}>
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: radius.full,
          backgroundColor: colours[avatarColourRole(categoryId)],
        }}
      />
      <View style={{ width: 50, flexShrink: 0 }}>
        <Text style={[timeStyle, { color: colours['text.primary'] }]}>{time}</Text>
        <Text style={[durationStyle, { color: colours['text.tertiary'] }]}>{duration}</Text>
      </View>
      <View style={{ flexGrow: 1, gap: space[1], minWidth: 0 }}>
        <Text style={[titleStyle, { color: colours['text.primary'] }]}>{title}</Text>
        <Text style={[subtitleStyle, { color: colours['text.secondary'] }]}>{subtitle}</Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {participants.map((participant, index) => (
          <View
            key={participant.memberId}
            style={index > 0 ? { marginLeft: -space[2] } : undefined}
          >
            <Avatar
              memberId={participant.memberId}
              initials={participant.initials}
              size={24}
              ringColor={colours['surface.raised']}
            />
          </View>
        ))}
      </View>
    </RowShell>
  );
}

/** FR-020: event row's loading form, at the same anatomy as `EventRow`. */
export interface EventRowSkeletonProps {
  readonly isLast?: boolean;
}

export function EventRowSkeleton({ isLast }: EventRowSkeletonProps) {
  const { colours } = useTheme();
  return (
    <RowShell isLast={isLast}>
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: radius.full,
          backgroundColor: colours['surface.sunken'],
        }}
      />
      <View style={{ width: 50, flexShrink: 0, gap: space[1] }}>
        <SkeletonBlock width={40} height={16} />
        <SkeletonBlock width={26} height={12} />
      </View>
      <View style={{ flexGrow: 1, gap: space[2], minWidth: 0 }}>
        <SkeletonBlock width="62%" height={16} />
        <SkeletonBlock width="38%" height={14} />
      </View>
      <SkeletonBlock width={24} height={24} rounded={radius.full} />
    </RowShell>
  );
}
