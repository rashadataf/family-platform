/**
 * Segmented control (artboard 08): at most three options, never for a
 * destructive choice. The two- and three-option shapes are the type's own
 * union — a caller cannot pass four.
 */
import { Pressable, Text, View } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';

export type SegmentedControlOptions = readonly [string, string] | readonly [string, string, string];

export interface SegmentedControlProps {
  readonly options: SegmentedControlOptions;
  readonly selectedIndex: number;
  readonly onChange: (index: number) => void;
}

export function SegmentedControl({ options, selectedIndex, onChange }: SegmentedControlProps) {
  const { colours } = useTheme();
  const labelStyle = typeStepToTextStyle(typography['body.sm']);

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space[1],
        padding: space[1],
        // The canvas draws this outer radius at 10px, off the scale
        // (FR-009); radius.md is the nearer real step, not `radius.sm + 2`
        // — an arithmetic expression would dodge the lint rule's literal
        // check without being any less an invented value.
        borderRadius: radius.md,
        backgroundColor: colours['action.quiet'],
      }}
    >
      {options.map((label, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              onChange(index);
            }}
            style={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              height: 36,
              borderRadius: radius.sm,
              backgroundColor: selected ? colours['surface.raised'] : 'transparent',
            }}
          >
            <Text
              style={[
                labelStyle,
                {
                  color: selected ? colours['text.primary'] : colours['text.secondary'],
                  fontWeight: selected ? 600 : 500,
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
