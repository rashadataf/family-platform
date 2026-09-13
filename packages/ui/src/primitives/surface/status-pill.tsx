/**
 * Status pill (artboard 01 draws the five roles; artboard 07 draws the
 * pill anatomy). A coloured dot plus a label, always drawn against its own
 * tint — never against canvas, which is why this component owns the
 * background and border, not just the dot.
 */
import { Text, View } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';

export type StatusPillStatus = 'positive' | 'caution' | 'critical' | 'info' | 'proposed';

const ROLES = {
  positive: {
    fg: 'status.positive.fg',
    bg: 'status.positive.bg',
    border: 'status.positive.border',
  },
  caution: { fg: 'status.caution.fg', bg: 'status.caution.bg', border: 'status.caution.border' },
  critical: {
    fg: 'status.critical.fg',
    bg: 'status.critical.bg',
    border: 'status.critical.border',
  },
  info: { fg: 'status.info.fg', bg: 'status.info.bg', border: 'status.info.border' },
  proposed: {
    fg: 'status.proposed.fg',
    bg: 'status.proposed.bg',
    border: 'status.proposed.border',
  },
} as const;

export interface StatusPillProps {
  readonly status: StatusPillStatus;
  readonly label: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  const { colours } = useTheme();
  const role = ROLES[status];
  const labelStyle = typeStepToTextStyle(typography.caption);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: space[2],
        paddingVertical: space[1],
        paddingHorizontal: space[3],
        borderRadius: radius.full,
        backgroundColor: colours[role.bg],
        borderWidth: 1,
        borderColor: colours[role.border],
      }}
    >
      {/* radius.full, not half of 6: any radius at or past half an element's
          own size renders a full circle — using the real token, rather than
          the exact half-width, is what keeps this a token reference and not
          a second off-scale literal one pixel different from the first. */}
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: radius.full,
          backgroundColor: colours[role.fg],
        }}
      />
      <Text style={[labelStyle, { color: colours[role.fg] }]}>{label}</Text>
    </View>
  );
}
