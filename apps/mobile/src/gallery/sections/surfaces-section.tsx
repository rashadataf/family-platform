/**
 * Artboard 07 — the surface family: Avatar's size scale, Card, EmptyState,
 * StatusPill's five statuses, and Toast (FR-028).
 */
import { View } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  StatusPill,
  Toast,
  space,
  useTheme,
  type AvatarSize,
  type StatusPillStatus,
} from '@fp/ui';
import { GallerySection, GalleryState } from '../section.js';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const AVATAR_SIZES: readonly AvatarSize[] = [24, 28, 32, 40, 44, 56];
const STATUSES: readonly StatusPillStatus[] = [
  'positive',
  'caution',
  'critical',
  'info',
  'proposed',
];

function noop(): void {
  // Gallery surfaces demonstrate appearance, not behaviour.
}

export function SurfacesSection() {
  const { colours } = useTheme();
  const ringColor = colours['surface.canvas'];

  return (
    <GallerySection title="Surfaces" note="Avatar, Card, EmptyState, StatusPill, Toast.">
      <GalleryState label="Avatar — every size">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          {AVATAR_SIZES.map((size) => (
            <Avatar key={size} memberId="ella" initials="E" size={size} />
          ))}
        </View>
      </GalleryState>
      <GalleryState label="Avatar — stack, overflow counter after three">
        {/*
          Canvas: -10px overlap, off-scale (FR-009) — -space[2] (-8) is the
          nearest real step, the same correction this board's other
          off-scale values already got. "+2" is a plain Avatar: `initials`
          is a label, not validated to be one or two letters of a name.
        */}
        <View style={{ flexDirection: 'row' }}>
          <Avatar memberId="ella" initials="E" ringColor={ringColor} />
          <View style={{ marginLeft: -space[2] }}>
            <Avatar memberId="sami" initials="S" ringColor={ringColor} />
          </View>
          <View style={{ marginLeft: -space[2] }}>
            <Avatar memberId="ada" initials="A" ringColor={ringColor} />
          </View>
          <View style={{ marginLeft: -space[2] }}>
            <Avatar memberId="overflow" initials="+2" ringColor={ringColor} />
          </View>
        </View>
      </GalleryState>
      <GalleryState label="Card">
        <Card>
          <View style={{ padding: space[4] }}>
            <PlaceholderIcon glyph="i" />
          </View>
        </Card>
      </GalleryState>
      {STATUSES.map((status) => (
        <GalleryState key={status} label={`StatusPill — ${status}`}>
          <StatusPill status={status} label={status} />
        </GalleryState>
      ))}
      <GalleryState label="EmptyState">
        <EmptyState
          icon={<PlaceholderIcon glyph="?" />}
          title="Nothing here yet"
          description="Add your first item to get started."
          action={<Button variant="primary" label="Add item" onPress={noop} />}
        />
      </GalleryState>
      <GalleryState label="Toast">
        <Toast
          icon={<PlaceholderIcon glyph="i" />}
          message="Changes saved."
          actionLabel="Undo"
          onAction={noop}
        />
      </GalleryState>
    </GallerySection>
  );
}
