/**
 * NotFound (artboard 09, pattern 04 — Constitution V): a cross-family
 * access attempt returns not-found, never forbidden, so a resource's mere
 * existence is never disclosed through wording, through a differently
 * shaped screen, or through timing. The only way to guarantee that is one
 * component with no prop that could distinguish "genuinely missing" from
 * "exists but not yours" — a `reason` prop would eventually be read and
 * branched on, so it does not exist here.
 */
import type { ReactElement } from 'react';
import { EmptyState } from '../../primitives/surface/empty-state.js';
import { Button } from '../../primitives/button/button.js';
import { assertNonEmpty } from '../guards.js';

export interface NotFoundProps {
  readonly icon: ReactElement;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}

export function NotFound({ icon, description, actionLabel, onAction }: NotFoundProps) {
  assertNonEmpty(description, 'description', 'NotFound');
  assertNonEmpty(actionLabel, 'actionLabel', 'NotFound');

  return (
    <EmptyState
      icon={icon}
      title="Not found"
      description={description}
      action={<Button variant="secondary" label={actionLabel} onPress={onAction} />}
    />
  );
}
