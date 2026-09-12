/**
 * Field (artboard 06). A single-line text control with a persistent visible
 * label, an optional helper or error line below it, and one documented
 * exception: `hideLabel`, for the one field the canvas allows to lean on its
 * placeholder — search. The label still exists there, as the accessible
 * name; it is hidden, not absent (artboard 06, "The one exception").
 *
 * FR-015 scope note: this covers the text-input-shaped states the canvas
 * draws (email, postcode, date-as-text, search, "assign to"). The canvas's
 * "Other controls" section also draws a multiline notes field and toggle/
 * checkbox controls — neither is one of this spec's five named primitive
 * families (Button, Field, row, surface, navigation), so neither is built
 * here. A future spec that needs them builds on this file's colour and
 * anatomy choices rather than re-deriving them.
 */
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';

/**
 * 14px — between space.3 (12) and space.4 (16), the one documented
 * off-scale value on this board (artboard 06's anatomy note: "held for
 * optical fit"). Named and commented, not a bare literal: the
 * `no-literal-design-values` lint rule inspects only a literal number
 * written directly in a padding/margin/gap property, so an identifier here
 * is the escape hatch its own doc comment describes — and there is
 * deliberately no type-level check standing behind this one value, unlike
 * every member of the `space` scale itself.
 */
const FIELD_HORIZONTAL_INSET = 14;

interface FieldBaseProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly leftIcon?: ReactNode;
  /** Replaces `helperText` and switches the field into its error visual. */
  readonly errorText?: string;
  readonly helperText?: string;
  /**
   * Search's documented exception (artboard 06, "The one exception"):
   * `label` is not rendered on screen, but is still `label`'s value, never
   * absent — it becomes the `TextInput`'s `accessibilityLabel` instead of
   * a visible line above the field. Every other field keeps its visible
   * label; there is no prop that drops the accessible name entirely,
   * because that is not the case the canvas sanctions.
   */
  readonly hideLabel?: boolean;
  readonly secureTextEntry?: boolean;
  readonly keyboardType?: TextInputProps['keyboardType'];
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
}

export type FieldProps = FieldBaseProps;

export function Field(props: FieldProps) {
  const {
    label,
    value,
    onChangeText,
    placeholder,
    disabled = false,
    leftIcon,
    errorText,
    helperText,
    hideLabel = false,
    secureTextEntry,
    keyboardType,
    autoCapitalize,
  } = props;
  const [focused, setFocused] = useState(false);
  const { colours } = useTheme();

  const hasError = errorText !== undefined && !disabled;
  const borderColor = disabled
    ? colours['border.subtle']
    : hasError
      ? colours['status.critical.fg']
      : focused
        ? colours['border.focus']
        : colours['border.strong'];
  const backgroundColor = disabled ? colours['surface.sunken'] : colours['surface.raised'];
  const textColor = disabled ? colours['action.disabledFg'] : colours['text.primary'];
  const helperColor = disabled
    ? colours['action.disabledFg']
    : hasError
      ? colours['status.critical.fg']
      : colours['text.secondary'];
  const helperLine = hasError ? errorText : helperText;

  const labelTextStyle = typeStepToTextStyle(typography['label.sm']);
  const bodyTextStyle = typeStepToTextStyle(typography['body.md']);
  const helperTextStyle = typeStepToTextStyle(typography['body.sm']);

  return (
    <View style={styles.column}>
      {!hideLabel && (
        <Text
          style={[labelTextStyle, { color: colours['text.secondary'], marginBottom: space[2] }]}
        >
          {label}
        </Text>
      )}
      <View
        style={[
          styles.control,
          {
            backgroundColor,
            borderColor,
            borderRadius: radius.sm,
            paddingHorizontal: FIELD_HORIZONTAL_INSET,
            outlineWidth: focused && !disabled && !hasError ? 2 : 0,
            outlineColor: colours['border.focus'],
            outlineOffset: 2,
            outlineStyle: 'solid',
          },
        ]}
      >
        {leftIcon}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colours['text.tertiary']}
          editable={!disabled}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          accessibilityLabel={hideLabel ? label : undefined}
          selectionColor={colours['border.focus']}
          cursorColor={colours['border.focus']}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          style={[bodyTextStyle, { color: textColor, flex: 1 }]}
        />
      </View>
      {helperLine !== undefined && (
        <Text style={[helperTextStyle, { color: helperColor, marginTop: space[2] }]}>
          {helperLine}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flexDirection: 'column',
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    gap: space[3],
  },
});
