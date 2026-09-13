/**
 * The component gallery (T050, FR-028/FR-028-amended): every state drawn on
 * artboards 05 through 09, reachable without walking a product flow. Not a
 * product screen — see `apps/mobile/src/app/gallery.tsx` for the
 * development-only gate.
 */
import { ScrollView } from 'react-native';
import { Header, space } from '@fp/ui';
import { ButtonsSection } from './sections/buttons-section.js';
import { FieldsSection } from './sections/fields-section.js';
import { RowsSection } from './sections/rows-section.js';
import { SurfacesSection } from './sections/surfaces-section.js';
import { NavigationSection } from './sections/navigation-section.js';
import { PatternsSection } from './sections/patterns-section.js';

export function GalleryScreen() {
  return (
    <>
      <Header title="Component gallery" />
      <ScrollView contentContainerStyle={{ gap: space[8], padding: space[4] }}>
        <ButtonsSection />
        <FieldsSection />
        <RowsSection />
        <SurfacesSection />
        <NavigationSection />
        <PatternsSection />
      </ScrollView>
    </>
  );
}
