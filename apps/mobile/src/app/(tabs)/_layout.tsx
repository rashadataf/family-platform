/**
 * The five destinations, in the order artboard 08 fixes: Today, Calendar,
 * Tasks, Vault, Family. A sixth is not a tab — "a new area becomes a
 * section inside Today" (artboard 08) — and there is nowhere to add one:
 * TabBar's `items` prop is a 5-tuple, not an array.
 *
 * `tabBar` renders @fp/ui's own TabBar in place of the default one, so the
 * canvas's design is what a family sees, while `<Tabs>` still owns real
 * routing, deep links and back-button behaviour underneath it.
 */
import { Tabs } from 'expo-router';
import { TabBar, type TabBarItems } from '@fp/ui';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const ITEMS: TabBarItems = [
  {
    key: 'index',
    label: 'Today',
    icon: <PlaceholderIcon glyph="◆" />,
    activeIcon: <PlaceholderIcon glyph="◆" active />,
  },
  {
    key: 'calendar',
    label: 'Calendar',
    icon: <PlaceholderIcon glyph="▦" />,
    activeIcon: <PlaceholderIcon glyph="▦" active />,
  },
  {
    key: 'tasks',
    label: 'Tasks',
    icon: <PlaceholderIcon glyph="☑" />,
    activeIcon: <PlaceholderIcon glyph="☑" active />,
  },
  {
    key: 'vault',
    label: 'Vault',
    icon: <PlaceholderIcon glyph="▣" />,
    activeIcon: <PlaceholderIcon glyph="▣" active />,
  },
  {
    key: 'family',
    label: 'Family',
    icon: <PlaceholderIcon glyph="◎" />,
    activeIcon: <PlaceholderIcon glyph="◎" active />,
  },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation, insets }) => (
        <TabBar
          items={ITEMS}
          activeKey={state.routes[state.index]?.name ?? ITEMS[0].key}
          bottomInset={insets.bottom}
          onSelect={(key) => {
            navigation.navigate(key);
          }}
        />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="vault" />
      <Tabs.Screen name="family" />
    </Tabs>
  );
}
