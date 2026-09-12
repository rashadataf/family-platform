/**
 * Row skeleton (artboard 07): surface.sunken blocks at the real row
 * anatomy. No spinner, no shimmer — a static placeholder, deliberately.
 * The canvas draws its icon tile at 10px and its bars at 6px radius;
 * neither is on the radius scale (FR-009) and the real rows this mimics
 * use radius.sm (8px) for their icon tile, so this uses radius.sm and
 * radius.xs throughout instead — a canvas correction, not a fresh design.
 */
import { View } from 'react-native';
import { radius, space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { Card } from './card.js';

export interface RowSkeletonProps {
  /** @default 3 */
  readonly count?: number;
}

function SkeletonRow({
  isLast,
  blockColor,
  dividerColor,
}: {
  readonly isLast: boolean;
  readonly blockColor: string;
  readonly dividerColor: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        borderBottomWidth: isLast ? 0 : 1,
        borderColor: dividerColor,
      }}
    >
      <View
        style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: blockColor }}
      />
      <View style={{ flexGrow: 1, gap: space[2] }}>
        <View
          style={{
            width: '62%',
            height: 14,
            borderRadius: radius.xs,
            backgroundColor: blockColor,
          }}
        />
        <View
          style={{
            width: '38%',
            height: 12,
            borderRadius: radius.xs,
            backgroundColor: blockColor,
          }}
        />
      </View>
    </View>
  );
}

export function RowSkeleton({ count = 3 }: RowSkeletonProps) {
  const { colours } = useTheme();
  const blockColor = colours['surface.sunken'];
  const dividerColor = colours['border.subtle'];

  return (
    <Card>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonRow
          key={index}
          isLast={index === count - 1}
          blockColor={blockColor}
          dividerColor={dividerColor}
        />
      ))}
    </Card>
  );
}
