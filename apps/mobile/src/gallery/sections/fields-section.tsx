/**
 * Artboard 06 — `Field`'s documented states: default, helper text, error
 * text, disabled, a left icon, and search's hidden-label exception
 * (FR-028).
 */
import { useState } from 'react';
import { Field } from '@fp/ui';
import { GallerySection, GalleryState } from '../section.js';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

export function FieldsSection() {
  const [value, setValue] = useState('');

  return (
    <GallerySection title="Field" note="A persistent visible label, and one documented exception.">
      <GalleryState label="Default">
        <Field label="Email" value={value} onChangeText={setValue} placeholder="you@example.com" />
      </GalleryState>
      <GalleryState label="Helper text">
        <Field
          label="Postcode"
          value={value}
          onChangeText={setValue}
          helperText="Used to find your nearest branch."
        />
      </GalleryState>
      <GalleryState label="Error">
        <Field
          label="Postcode"
          value={value}
          onChangeText={setValue}
          errorText="Enter a valid postcode."
        />
      </GalleryState>
      <GalleryState label="Disabled">
        <Field label="Account ID" value="FP-10293" onChangeText={setValue} disabled />
      </GalleryState>
      <GalleryState label="Left icon">
        <Field
          label="Assign to"
          value={value}
          onChangeText={setValue}
          leftIcon={<PlaceholderIcon glyph="@" />}
        />
      </GalleryState>
      <GalleryState label="Search (label hidden, not absent)">
        <Field
          label="Search"
          value={value}
          onChangeText={setValue}
          placeholder="Search"
          hideLabel
          leftIcon={<PlaceholderIcon glyph="?" />}
        />
      </GalleryState>
    </GallerySection>
  );
}
