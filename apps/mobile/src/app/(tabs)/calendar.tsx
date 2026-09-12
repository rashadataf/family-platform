/**
 * Calendar (artboard 08, tab destination). Structural only — this spec
 * (007) builds the design system and its enforcement, not this screen's
 * product content, which is a future feature's scope.
 */
import { View } from 'react-native';
import { Header } from '@fp/ui';

export default function CalendarScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Header title="Calendar" />
    </View>
  );
}
