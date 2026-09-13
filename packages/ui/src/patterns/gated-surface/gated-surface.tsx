/**
 * GatedSurface (artboard 09, pattern 02 — Constitution VI): a child has no
 * credentials and no login path, so their records are reachable only
 * through an active guardianship relationship — family membership alone is
 * never enough. The gate has to be visible rather than silently hiding
 * rows, or a parent cannot tell what the other guardian can see, so this
 * refuses to render without naming who may see the content and without
 * disclosing that access is recorded.
 */
import { Text, View } from 'react-native';
import { radius, space, typography } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { Button } from '../../primitives/button/button.js';
import { assertNonEmpty } from '../guards.js';

export interface GatedSurfaceProps {
  readonly title: string;
  readonly description: string;
  /** Who may see this, e.g. "Guardians" — shown as a badge (never hide the gate). */
  readonly allowedGroupLabel: string;
  /** Disclosed alongside every gate: reads of this content are recorded. */
  readonly auditNotice: string;
  readonly actionLabel: string;
  readonly onRequestAccess: () => void;
}

export function GatedSurface({
  title,
  description,
  allowedGroupLabel,
  auditNotice,
  actionLabel,
  onRequestAccess,
}: GatedSurfaceProps) {
  assertNonEmpty(allowedGroupLabel, 'allowedGroupLabel', 'GatedSurface');
  assertNonEmpty(auditNotice, 'auditNotice', 'GatedSurface');

  const { colours } = useTheme();
  const badgeStyle = typeStepToTextStyle(typography.overline);
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const descriptionStyle = typeStepToTextStyle(typography['body.md']);
  const noticeStyle = typeStepToTextStyle(typography.mono);

  return (
    <View
      style={{
        gap: space[4],
        padding: space[6],
        borderRadius: radius.md,
        backgroundColor: colours['sensitive.bg'],
        borderWidth: 1,
        borderColor: colours['sensitive.border'],
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          paddingVertical: space[1],
          paddingHorizontal: space[2],
          borderRadius: radius.full,
          backgroundColor: colours['surface.raised'],
        }}
      >
        <Text style={[badgeStyle, { color: colours['sensitive.fg'], textTransform: 'uppercase' }]}>
          {`${allowedGroupLabel} only`}
        </Text>
      </View>
      <View style={{ gap: space[1] }}>
        <Text style={[titleStyle, { color: colours['text.primary'] }]}>{title}</Text>
        <Text style={[descriptionStyle, { color: colours['text.secondary'] }]}>{description}</Text>
      </View>
      <View
        style={{
          padding: space[2],
          borderRadius: radius.sm,
          backgroundColor: colours['action.quiet'],
        }}
      >
        <Text style={[noticeStyle, { color: colours['text.secondary'] }]}>{auditNotice}</Text>
      </View>
      <Button variant="secondary" label={actionLabel} onPress={onRequestAccess} />
    </View>
  );
}
