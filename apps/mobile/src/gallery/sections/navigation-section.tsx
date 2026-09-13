/**
 * Artboard 08 — Header (compact and large), SegmentedControl (two- and
 * three-option), TabBar, Sheet and Dialog (FR-028).
 */
import { useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Dialog,
  Header,
  SegmentedControl,
  Sheet,
  TabBar,
  space,
  type TabBarItems,
} from '@fp/ui';
import { GallerySection, GalleryState } from '../section.js';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const TAB_ITEMS: TabBarItems = [
  {
    key: 'a',
    label: 'Today',
    icon: <PlaceholderIcon glyph="◆" />,
    activeIcon: <PlaceholderIcon glyph="◆" active />,
  },
  {
    key: 'b',
    label: 'Calendar',
    icon: <PlaceholderIcon glyph="▦" />,
    activeIcon: <PlaceholderIcon glyph="▦" active />,
  },
  {
    key: 'c',
    label: 'Tasks',
    icon: <PlaceholderIcon glyph="☑" />,
    activeIcon: <PlaceholderIcon glyph="☑" active />,
  },
  {
    key: 'd',
    label: 'Vault',
    icon: <PlaceholderIcon glyph="▣" />,
    activeIcon: <PlaceholderIcon glyph="▣" active />,
  },
  {
    key: 'e',
    label: 'Family',
    icon: <PlaceholderIcon glyph="◎" />,
    activeIcon: <PlaceholderIcon glyph="◎" active />,
  },
];

function noop(): void {
  // Gallery navigation demonstrates appearance, not routing.
}

export function NavigationSection() {
  const [activeTab, setActiveTab] = useState(TAB_ITEMS[0].key);
  const [twoOption, setTwoOption] = useState(0);
  const [threeOption, setThreeOption] = useState(0);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);

  return (
    <GallerySection title="Navigation" note="Header, SegmentedControl, TabBar, Sheet, Dialog.">
      <GalleryState label="Header — compact">
        <Header title="Family" />
      </GalleryState>
      <GalleryState label="Header — compact, with back and one action">
        <Header
          title="Ella"
          onBack={noop}
          action={{
            icon: <PlaceholderIcon glyph="+" />,
            onPress: noop,
            accessibilityLabel: 'Add',
          }}
        />
      </GalleryState>
      <GalleryState label="Header — large">
        <Header variant="large" title="Thursday" subtitle="12 September · 4 things today" />
      </GalleryState>
      <GalleryState label="SegmentedControl — two options">
        <SegmentedControl
          options={['Light', 'Dark']}
          selectedIndex={twoOption}
          onChange={setTwoOption}
        />
      </GalleryState>
      <GalleryState label="SegmentedControl — three options">
        <SegmentedControl
          options={['System', 'Light', 'Dark']}
          selectedIndex={threeOption}
          onChange={setThreeOption}
        />
      </GalleryState>
      <GalleryState label="TabBar">
        <TabBar items={TAB_ITEMS} activeKey={activeTab} onSelect={setActiveTab} bottomInset={0} />
      </GalleryState>
      <GalleryState label="Sheet">
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button
            variant="secondary"
            label="Open sheet"
            onPress={() => {
              setSheetVisible(true);
            }}
          />
        </View>
        <Sheet
          visible={sheetVisible}
          onDismiss={() => {
            setSheetVisible(false);
          }}
        >
          <View style={{ padding: space[4] }}>
            <PlaceholderIcon glyph="=" />
          </View>
        </Sheet>
      </GalleryState>
      <GalleryState label="Dialog">
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button
            variant="destructive"
            label="Open dialog"
            onPress={() => {
              setDialogVisible(true);
            }}
          />
        </View>
        <Dialog
          visible={dialogVisible}
          title="Delete this document?"
          description="This cannot be undone."
          destructiveLabel="Delete"
          onDestructive={() => {
            setDialogVisible(false);
          }}
          cancelLabel="Keep it"
          onCancel={() => {
            setDialogVisible(false);
          }}
        />
      </GalleryState>
    </GallerySection>
  );
}
