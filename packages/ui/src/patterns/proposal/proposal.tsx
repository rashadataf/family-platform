/**
 * Proposal (artboard 09, pattern 01 — Constitution VII, ARCHITECTURE §5.5,
 * §5.8): "an extraction result is what a model believes... it is stored in
 * the AI context, it is not a document attribute, and no reminder may be
 * generated from it." Refuses without a source reference and a confidence,
 * renders visually distinct (status.proposed), is labelled not saved, and
 * — the property that matters most — exposes no prop that could commit the
 * value itself. `onConfirm` fires only from the person tapping Confirm;
 * there is no `autoConfirm`, no default action, no way to construct one
 * that starts already accepted.
 */
import { Text, View } from 'react-native';
import { radius, space, typography } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { Button } from '../../primitives/button/button.js';
import { assertConfidenceInRange, assertNonEmpty } from '../guards.js';

export interface ProposalProps {
  readonly title: string;
  readonly description: string;
  /** Where the model read this from — shown, never hidden (artboard 09: "NEVER... hide the confidence or the citation"). */
  readonly sourceReference: string;
  /** 0–1. Required, not optional — a proposal with no confidence is not renderable. */
  readonly confidence: number;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
  readonly onDismiss: () => void;
}

export function Proposal({
  title,
  description,
  sourceReference,
  confidence,
  onConfirm,
  onEdit,
  onDismiss,
}: ProposalProps) {
  assertNonEmpty(sourceReference, 'sourceReference', 'Proposal');
  assertConfidenceInRange(confidence, 'Proposal');

  const { colours } = useTheme();
  const labelStyle = typeStepToTextStyle(typography.overline);
  const titleStyle = typeStepToTextStyle(typography['title.sm']);
  const descriptionStyle = typeStepToTextStyle(typography['body.md']);
  const provenanceStyle = typeStepToTextStyle(typography.mono);
  const noticeStyle = typeStepToTextStyle(typography.mono);

  return (
    <View
      style={{
        gap: space[4],
        padding: space[4],
        borderRadius: radius.md,
        backgroundColor: colours['status.proposed.bg'],
        borderWidth: 1,
        borderColor: colours['status.proposed.border'],
      }}
    >
      <Text
        style={[labelStyle, { color: colours['status.proposed.fg'], textTransform: 'uppercase' }]}
      >
        Proposed · not saved
      </Text>
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
        <Text style={[provenanceStyle, { color: colours['text.secondary'] }]}>
          {`extraction · confidence ${confidence.toFixed(2)} · ${sourceReference}`}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button variant="primary" label="Confirm" onPress={onConfirm} />
        <Button variant="secondary" label="Edit" onPress={onEdit} />
        <Button variant="ghost" label="Dismiss" onPress={onDismiss} />
      </View>
      <Text style={[noticeStyle, { color: colours['text.secondary'] }]}>
        Nothing is saved and no reminder exists until someone confirms.
      </Text>
    </View>
  );
}
