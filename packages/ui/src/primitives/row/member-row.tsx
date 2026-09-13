/**
 * Member row (artboard 07): a 44px avatar, name and role summary, an
 * optional sensitivity badge (the canvas's "Guardians" example — sensitive.*
 * roles, not a StatusPill status, because it names who may see something
 * rather than the state of something), and a disclosure chevron.
 */
import { Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';
import { Avatar, type AvatarProps } from '../surface/avatar.js';
import { RowShell } from './row-shell.js';
import { SkeletonBlock } from './skeleton-block.js';

export interface MemberRowBadge {
  readonly icon: ReactElement;
  readonly label: string;
}

export interface MemberRowProps {
  readonly member: Pick<AvatarProps, 'memberId' | 'initials'>;
  readonly name: string;
  readonly roleSummary: string;
  readonly badge?: MemberRowBadge;
  readonly isLast?: boolean;
}

export function MemberRow({ member, name, roleSummary, badge, isLast }: MemberRowProps) {
  const { colours } = useTheme();
  const nameStyle = typeStepToTextStyle(typography['title.sm']);
  const roleStyle = typeStepToTextStyle(typography['body.sm']);
  const badgeStyle = typeStepToTextStyle(typography.caption);
  const chevronStyle = typeStepToTextStyle(typography['body.lg']);

  return (
    <RowShell isLast={isLast}>
      <Avatar memberId={member.memberId} initials={member.initials} size={44} />
      <View style={{ flexGrow: 1, gap: space[1], minWidth: 0 }}>
        <Text style={[nameStyle, { color: colours['text.primary'] }]}>{name}</Text>
        <Text style={[roleStyle, { color: colours['text.secondary'] }]}>{roleSummary}</Text>
      </View>
      {badge !== undefined && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[1],
            paddingVertical: space[1],
            paddingHorizontal: space[2],
            borderRadius: radius.full,
            backgroundColor: colours['sensitive.bg'],
            borderWidth: 1,
            borderColor: colours['sensitive.border'],
          }}
        >
          {badge.icon}
          <Text style={[badgeStyle, { color: colours['sensitive.fg'] }]}>{badge.label}</Text>
        </View>
      )}
      <Text style={[chevronStyle, { color: colours['text.tertiary'] }]}>›</Text>
    </RowShell>
  );
}

/** FR-020: member row's loading form, at the same anatomy as `MemberRow`. */
export interface MemberRowSkeletonProps {
  readonly isLast?: boolean;
}

export function MemberRowSkeleton({ isLast }: MemberRowSkeletonProps) {
  return (
    <RowShell isLast={isLast}>
      <SkeletonBlock width={44} height={44} rounded={radius.full} />
      <View style={{ flexGrow: 1, gap: space[2], minWidth: 0 }}>
        <SkeletonBlock width="50%" height={16} />
        <SkeletonBlock width="70%" height={14} />
      </View>
    </RowShell>
  );
}
