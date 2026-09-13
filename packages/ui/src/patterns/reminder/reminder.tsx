/**
 * Reminder (artboard 09, pattern 03 — ARCHITECTURE §5.6): every scheduled
 * reminder carries the rule id, the rule version and the source aggregate
 * that triggered it, stored precisely so "why did the app tell me this"
 * always has an answer — which means the answer belongs on the reminder
 * itself, not buried in a settings screen. Refuses to render without all
 * three, since a reminder with no traceable origin is exactly what this
 * component exists to prevent.
 */
import { Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { radius, space, typography } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { Button } from '../../primitives/button/button.js';
import { assertNonEmpty } from '../guards.js';

export type ReminderTone = 'positive' | 'caution' | 'critical' | 'info';

const TONES = {
  positive: { bg: 'status.positive.bg', border: 'status.positive.border' },
  caution: { bg: 'status.caution.bg', border: 'status.caution.border' },
  critical: { bg: 'status.critical.bg', border: 'status.critical.border' },
  info: { bg: 'status.info.bg', border: 'status.info.border' },
} as const;

export interface ReminderProps {
  readonly icon: ReactElement;
  readonly tone: ReminderTone;
  readonly title: string;
  readonly subtitle: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly sourceReference: string;
  readonly primaryActionLabel: string;
  readonly onPrimaryAction: () => void;
  readonly secondaryActionLabel: string;
  readonly onSecondaryAction: () => void;
}

export function Reminder({
  icon,
  tone,
  title,
  subtitle,
  ruleId,
  ruleVersion,
  sourceReference,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: ReminderProps) {
  assertNonEmpty(ruleId, 'ruleId', 'Reminder');
  assertNonEmpty(ruleVersion, 'ruleVersion', 'Reminder');
  assertNonEmpty(sourceReference, 'sourceReference', 'Reminder');

  const { colours } = useTheme();
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const subtitleStyle = typeStepToTextStyle(typography['body.md']);
  const provenanceStyle = typeStepToTextStyle(typography.mono);
  const tonedColours = TONES[tone];

  return (
    <View
      style={{
        gap: space[3],
        padding: space[4],
        borderRadius: radius.md,
        backgroundColor: colours['surface.raised'],
        borderWidth: 1,
        borderColor: colours['surface.sunken'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colours[tonedColours.bg],
            borderWidth: 1,
            borderColor: colours[tonedColours.border],
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, gap: space[1] }}>
          <Text style={[titleStyle, { color: colours['text.primary'] }]}>{title}</Text>
          <Text style={[subtitleStyle, { color: colours['text.secondary'] }]}>{subtitle}</Text>
        </View>
      </View>
      <View
        style={{
          padding: space[2],
          borderRadius: radius.sm,
          backgroundColor: colours['action.quiet'],
        }}
      >
        <Text style={[provenanceStyle, { color: colours['text.secondary'] }]}>
          {`${ruleId} rule v${ruleVersion} · source: ${sourceReference}`}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button variant="primary" label={primaryActionLabel} onPress={onPrimaryAction} />
        <Button variant="secondary" label={secondaryActionLabel} onPress={onSecondaryAction} />
      </View>
    </View>
  );
}
