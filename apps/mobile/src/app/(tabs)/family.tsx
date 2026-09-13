/**
 * Family (artboard 08, tab destination). Structural only — this spec
 * (007) builds the design system and its enforcement, not this screen's
 * product content, which is a future feature's scope. The one exception is
 * the appearance override (T035): it has to live somewhere reachable, and
 * this is the closest thing to a settings surface this phase has.
 */
import { View } from 'react-native';
import { Card, Header, SegmentedControl, space, useThemePreference } from '@fp/ui';
import type { ThemePreference } from '@fp/ui';

const OPTIONS = ['System', 'Light', 'Dark'] as const;
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export default function FamilyScreen() {
  const { preference, setPreference } = useThemePreference();

  return (
    <View style={{ flex: 1 }}>
      <Header title="Family" />
      <View style={{ padding: space[4] }}>
        <Card>
          <View style={{ padding: space[4], gap: space[3] }}>
            <SegmentedControl
              options={OPTIONS}
              selectedIndex={PREFERENCES.indexOf(preference)}
              onChange={(index) => {
                setPreference(PREFERENCES[index]);
              }}
            />
          </View>
        </Card>
      </View>
    </View>
  );
}
