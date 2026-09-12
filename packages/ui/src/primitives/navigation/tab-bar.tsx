/**
 * Tab bar (artboard 08). Five destinations, fixed for the life of the
 * product — "a sixth would push the tab bar past the point where a thumb
 * can hit one reliably, so a new area becomes a section inside Today, not
 * a tab." The five-member tuple below is that rule enforced as a type: a
 * caller cannot pass a sixth item, only relabel or reorder the five.
 */
import { Pressable, Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { space } from '../../tokens/index.js';
import { useTheme } from '../../theme/index.js';
import { typeStepToTextStyle } from '../../internal/type-style.js';
import { typography } from '../../tokens/index.js';

export interface TabBarItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactElement;
  readonly activeIcon: ReactElement;
}

/** Exactly five — see the module doc comment. */
export type TabBarItems = readonly [TabBarItem, TabBarItem, TabBarItem, TabBarItem, TabBarItem];

export interface TabBarProps {
  readonly items: TabBarItems;
  readonly activeKey: string;
  readonly onSelect: (key: string) => void;
  /**
   * The home-indicator safe area, in px. Required rather than defaulted:
   * this package takes no dependency on react-native-safe-area-context, so
   * the real device value is the caller's to supply (from
   * `useSafeAreaInsets().bottom`), not a guess made here.
   */
  readonly bottomInset: number;
}

export function TabBar({ items, activeKey, onSelect, bottomInset }: TabBarProps) {
  const { colours } = useTheme();
  const labelStyle = typeStepToTextStyle(typography.overline);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingTop: space[3],
        paddingBottom: bottomInset,
        paddingHorizontal: space[2],
        backgroundColor: colours['surface.raised'],
        borderTopWidth: 1,
        borderColor: colours['border.subtle'],
      }}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => {
              onSelect(item.key);
            }}
            style={{ flexGrow: 1, alignItems: 'center', gap: space[1] }}
          >
            {active ? item.activeIcon : item.icon}
            <Text
              style={[
                labelStyle,
                {
                  color: active ? colours['action.primary'] : colours['text.tertiary'],
                  fontWeight: active ? 600 : 500,
                  textTransform: 'none',
                  letterSpacing: 0,
                },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
