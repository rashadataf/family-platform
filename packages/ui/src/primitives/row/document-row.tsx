/**
 * Document row (artboard 07): a 40px icon tile tinted by status, a title
 * (with an optional lock for a guardian-gated document), a status pill,
 * and a disclosure chevron.
 */
import { Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';
import { StatusPill, type StatusPillStatus } from '../surface/status-pill.js';
import { RowShell } from './row-shell.js';
import { SkeletonBlock } from './skeleton-block.js';

const TILE_ROLES = {
  positive: { bg: 'status.positive.bg', border: 'status.positive.border' },
  caution: { bg: 'status.caution.bg', border: 'status.caution.border' },
  critical: { bg: 'status.critical.bg', border: 'status.critical.border' },
  info: { bg: 'status.info.bg', border: 'status.info.border' },
  proposed: { bg: 'status.proposed.bg', border: 'status.proposed.border' },
} as const;

export interface DocumentRowProps {
  readonly icon: ReactElement;
  readonly status: StatusPillStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly statusLabel: string;
  /** Rendered before the title — Principle VI's access-is-visible signal. */
  readonly lockIcon?: ReactElement;
  readonly isLast?: boolean;
}

export function DocumentRow({
  icon,
  status,
  title,
  subtitle,
  statusLabel,
  lockIcon,
  isLast,
}: DocumentRowProps) {
  const { colours } = useTheme();
  const tile = TILE_ROLES[status];
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const subtitleStyle = typeStepToTextStyle(typography['body.sm']);
  const chevronStyle = typeStepToTextStyle(typography['body.lg']);

  return (
    <RowShell isLast={isLast}>
      <View
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colours[tile.bg],
          borderWidth: 1,
          borderColor: colours[tile.border],
        }}
      >
        {icon}
      </View>
      <View style={{ flexGrow: 1, gap: space[1], minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          {lockIcon}
          <Text style={[titleStyle, { color: colours['text.primary'] }]}>{title}</Text>
        </View>
        <Text style={[subtitleStyle, { color: colours['text.secondary'] }]}>{subtitle}</Text>
      </View>
      <StatusPill status={status} label={statusLabel} />
      <Text style={[chevronStyle, { color: colours['text.tertiary'] }]}>›</Text>
    </RowShell>
  );
}

/** FR-020: document row's loading form, at the same anatomy as `DocumentRow`. */
export interface DocumentRowSkeletonProps {
  readonly isLast?: boolean;
}

export function DocumentRowSkeleton({ isLast }: DocumentRowSkeletonProps) {
  return (
    <RowShell isLast={isLast}>
      <SkeletonBlock width={40} height={40} rounded={radius.sm} />
      <View style={{ flexGrow: 1, gap: space[2], minWidth: 0 }}>
        <SkeletonBlock width="62%" height={16} />
        <SkeletonBlock width="38%" height={14} />
      </View>
      <SkeletonBlock width={72} height={22} rounded={radius.full} />
    </RowShell>
  );
}
