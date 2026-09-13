/**
 * Artboard 05 — every `Button` variant × size, plus its disabled and
 * loading states (FR-028).
 */
import { View } from 'react-native';
import { Button, space, type ButtonSize, type ButtonVariant } from '@fp/ui';
import { GallerySection, GalleryState } from '../section.js';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'quiet',
  'ghost',
  'destructive',
];
const SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

function noop(): void {
  // Gallery buttons demonstrate appearance, not behaviour.
}

export function ButtonsSection() {
  return (
    <GallerySection title="Button" note="Five variants, three sizes, five states.">
      {SIZES.map((size) => (
        <GalleryState key={size} label={`Size: ${size}`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size} label={variant} onPress={noop} />
            ))}
          </View>
        </GalleryState>
      ))}
      <GalleryState label="Disabled">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} label={variant} disabled onPress={noop} />
          ))}
        </View>
      </GalleryState>
      <GalleryState label="Loading">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} label={variant} loading onPress={noop} />
          ))}
        </View>
      </GalleryState>
      <GalleryState label="Full width">
        <Button variant="primary" label="Full width" fullWidth onPress={noop} />
      </GalleryState>
      <GalleryState label="Icon only">
        <Button
          variant="secondary"
          iconOnly
          icon={<PlaceholderIcon glyph="+" />}
          accessibilityLabel="Example icon-only button"
          onPress={noop}
        />
      </GalleryState>
    </GallerySection>
  );
}
