/**
 * Dialog (artboard 08): "for confirming, and only ever for something that
 * cannot be undone." The type reflects that scope rather than a general
 * modal — there is no non-destructive variant, because the canvas draws
 * none: destructive action first, the escape route below it, wider and
 * calmer, "so a mistimed tap lands on 'Keep it'."
 */
import { Modal, Text, View } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { elevation } from '../../tokens/index.js';
import { elevationToShadowStyle } from '../../internal/elevation-style.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';
import { Button } from '../button/button.js';

export interface DialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly description: string;
  readonly destructiveLabel: string;
  readonly onDestructive: () => void;
  readonly cancelLabel: string;
  readonly onCancel: () => void;
}

export function Dialog({
  visible,
  title,
  description,
  destructiveLabel,
  onDestructive,
  cancelLabel,
  onCancel,
}: DialogProps) {
  const { colours } = useTheme();
  const shadow = elevationToShadowStyle('3', elevation['3']);
  const titleStyle = typeStepToTextStyle(typography['title.lg']);
  const descriptionStyle = typeStepToTextStyle(typography['body.sm']);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colours['surface.scrim'],
        }}
      >
        <View style={[shadow, { width: 342 }]}>
          <View
            style={{
              gap: space[5],
              padding: space[6],
              backgroundColor: colours['surface.raised'],
              borderRadius: radius.lg,
            }}
          >
            <View style={{ gap: space[2] }}>
              <Text style={[titleStyle, { color: colours['text.primary'] }]}>{title}</Text>
              <Text style={[descriptionStyle, { color: colours['text.secondary'] }]}>
                {description}
              </Text>
            </View>
            <View style={{ gap: space[3] }}>
              <Button
                variant="destructive"
                fullWidth
                label={destructiveLabel}
                onPress={onDestructive}
              />
              <Button variant="secondary" fullWidth label={cancelLabel} onPress={onCancel} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
