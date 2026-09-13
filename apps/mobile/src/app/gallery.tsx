/**
 * `/gallery` (T050): registered outside `(tabs)`, so it is reachable by
 * direct navigation without being one of the five product destinations
 * FR-026 fixes. Development builds only — a release build redirects home
 * before rendering anything the gallery contains.
 */
import { Redirect } from 'expo-router';
import { GalleryScreen } from '../gallery/gallery-screen.js';

export default function GalleryRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return <GalleryScreen />;
}
