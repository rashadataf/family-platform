/**
 * Task row (artboard 07): a 24px checkbox, a title that strikes through and
 * fades to text.tertiary when done, a subtitle, and the assignee's avatar.
 *
 * No SVG icon library exists in this package yet (ADR-016 scoped this spec
 * to tokens and primitives, not an icon set) — the checkmark is a plain
 * glyph, not a stroke-drawn icon like the canvas's. A real icon system is a
 * later spec's concern; this is not the place to add react-native-svg for
 * one glyph.
 */
import { Pressable, Text, View } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';
import { Avatar, type AvatarProps } from '../surface/avatar.js';
import { RowShell } from './row-shell.js';
import { SkeletonBlock } from './skeleton-block.js';

export interface TaskRowProps {
  readonly title: string;
  readonly subtitle: string;
  readonly done: boolean;
  readonly onToggle: () => void;
  readonly assignee: Pick<AvatarProps, 'memberId' | 'initials'>;
  readonly isLast?: boolean;
}

export function TaskRow({ title, subtitle, done, onToggle, assignee, isLast }: TaskRowProps) {
  const { colours } = useTheme();
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const subtitleStyle = typeStepToTextStyle(typography['body.sm']);
  const checkStyle = typeStepToTextStyle(typography.caption);

  return (
    <RowShell isLast={isLast}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={title}
        onPress={onToggle}
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.xs,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? colours['action.primary'] : colours['surface.raised'],
          borderWidth: done ? 0 : 1.5,
          borderColor: colours['border.strong'],
        }}
      >
        {done && (
          <Text style={[checkStyle, { color: colours['text.onAction'], fontWeight: 700 }]}>✓</Text>
        )}
      </Pressable>
      <View style={{ flexGrow: 1, gap: space[1], minWidth: 0 }}>
        <Text
          style={[
            titleStyle,
            {
              color: done ? colours['text.tertiary'] : colours['text.primary'],
              textDecorationLine: done ? 'line-through' : 'none',
            },
          ]}
        >
          {title}
        </Text>
        <Text style={[subtitleStyle, { color: colours['text.secondary'] }]}>{subtitle}</Text>
      </View>
      <Avatar memberId={assignee.memberId} initials={assignee.initials} size={28} />
    </RowShell>
  );
}

/** FR-020: task row's loading form, at the same anatomy as `TaskRow`. */
export interface TaskRowSkeletonProps {
  readonly isLast?: boolean;
}

export function TaskRowSkeleton({ isLast }: TaskRowSkeletonProps) {
  return (
    <RowShell isLast={isLast}>
      <SkeletonBlock width={24} height={24} />
      <View style={{ flexGrow: 1, gap: space[2], minWidth: 0 }}>
        <SkeletonBlock width="62%" height={16} />
        <SkeletonBlock width="38%" height={14} />
      </View>
      <SkeletonBlock width={28} height={28} rounded={radius.full} />
    </RowShell>
  );
}
