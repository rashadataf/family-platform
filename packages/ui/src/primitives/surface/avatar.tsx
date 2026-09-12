/**
 * Avatar (artboard 07). Colour is derived from the member id, never chosen
 * or passed in — "the same person is the same colour on every device".
 * Initials only, by design: "No photo upload for a child record — a face
 * is personal data with no feature requiring it."
 */
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/index.js';
import { avatarColourRole } from '../../internal/avatar-colour.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography, type TypeStep } from '../../tokens/index.js';

/** Every size the canvas draws — 24/28/32 for rows and stacks, 40/44/56 standalone. */
export type AvatarSize = 24 | 28 | 32 | 40 | 44 | 56;

/**
 * The canvas's own avatar swatches scale their label continuously with the
 * circle (11/11/12/15/16/20px). That is not a typography STEP — FR-009
 * closes the scale to exactly the members `typography` declares, so each
 * tier below is a real step, picked for the closest size at that diameter,
 * rather than a bespoke size/lineHeight invented to match the mockup pixel
 * for pixel.
 */
const LABEL_STEP: Record<AvatarSize, TypeStep> = {
  24: typography.overline,
  28: typography.overline,
  32: typography.caption,
  40: typography['label.lg'],
  44: typography['title.sm'],
  56: typography['title.lg'],
};

export interface AvatarProps {
  readonly memberId: string;
  /** The one or two characters shown — the canvas draws a single initial. */
  readonly initials: string;
  /** @default 40 */
  readonly size?: AvatarSize;
  /**
   * A ring against the surface behind it, for a stacked or overlapping
   * avatar (artboard 07, "stack"). The colour is the CALLER's surface, not
   * a token this component can infer — a stack on a card and a stack on
   * canvas need different ring colours.
   */
  readonly ringColor?: string;
}

export function Avatar({ memberId, initials, size = 40, ringColor }: AvatarProps) {
  const { colours } = useTheme();
  const role = avatarColourRole(memberId);
  const labelStyle = typeStepToTextStyle(LABEL_STEP[size]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colours[role],
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...(ringColor !== undefined
          ? { outlineWidth: 2, outlineColor: ringColor, outlineStyle: 'solid' as const }
          : {}),
      }}
    >
      <Text style={[labelStyle, { color: colours['text.onAction'], letterSpacing: 0.5 }]}>
        {initials}
      </Text>
    </View>
  );
}
