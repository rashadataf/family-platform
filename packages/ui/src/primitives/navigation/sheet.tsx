/**
 * Bottom sheet (artboard 08): "for choosing." Over a scrim, radius.xl top
 * corners, a grabber, dismissible by tapping the scrim.
 */
import { Modal, Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { elevation } from '../../tokens/index.js';
import { elevationToShadowStyle } from '../../internal/elevation-style.js';

export interface SheetProps {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}

export function Sheet({ visible, onDismiss, children }: SheetProps) {
  const { colours } = useTheme();
  const shadow = elevationToShadowStyle('3', elevation['3']);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colours['surface.scrim'] }}
      >
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View style={shadow}>
          <View
            style={{
              gap: space[5],
              paddingTop: space[3],
              paddingHorizontal: space[6],
              // The canvas draws 28px here, off the scale (FR-009);
              // space.7 (32) is the nearer real step.
              paddingBottom: space[7],
              backgroundColor: colours['surface.raised'],
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: radius.full,
                backgroundColor: colours['border.strong'],
              }}
            />
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}
