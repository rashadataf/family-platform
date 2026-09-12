/**
 * The shared anatomy every row type sits on (artboard 07): horizontal
 * layout, 12px gap, 16/12 padding, a divider on all but the last row in a
 * list. Internal — not exported from the package, because "four row types
 * cover the whole product" (artboard 07) is a promise about the four named
 * exports, not an invitation to build a fifth from this shell.
 */
import { View } from 'react-native';
import type { ReactNode } from 'react';
import { space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';

export interface RowShellProps {
  readonly children: ReactNode;
  /** @default false — a row has a divider unless it is told it is last. */
  readonly isLast?: boolean;
}

export function RowShell({ children, isLast = false }: RowShellProps) {
  const { colours } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingVertical: space[3],
        paddingHorizontal: space[4],
        borderBottomWidth: isLast ? 0 : 1,
        borderColor: colours['border.subtle'],
      }}
    >
      {children}
    </View>
  );
}
