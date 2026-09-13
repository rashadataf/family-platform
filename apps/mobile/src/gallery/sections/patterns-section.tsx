/**
 * Artboard 09 — the four constitution-carrying patterns (FR-028).
 */
import { GatedSurface, NotFound, Proposal, Reminder, type ReminderTone } from '@fp/ui';
import { GallerySection, GalleryState } from '../section.js';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const TONES: readonly ReminderTone[] = ['positive', 'caution', 'critical', 'info'];

function noop(): void {
  // Gallery patterns demonstrate appearance, not the behaviour they guard.
}

export function PatternsSection() {
  return (
    <GallerySection title="Patterns" note="Proposal, GatedSurface, Reminder, NotFound.">
      <GalleryState label="Proposal">
        <Proposal
          title="Add 'Book dentist' to Ella's tasks?"
          description="Extracted from a school email received today."
          sourceReference="email-9f21"
          confidence={0.82}
          onConfirm={noop}
          onEdit={noop}
          onDismiss={noop}
        />
      </GalleryState>
      <GalleryState label="GatedSurface">
        <GatedSurface
          title="Ella's records"
          description="You are a member of this family but not one of Ella's guardians, so her school, health and nursery records are not shown here."
          allowedGroupLabel="Guardians"
          auditNotice="Every open of a child record is written to the audit log — actor, subject, purpose, result."
          actionLabel="Ask a guardian for access"
          onRequestAccess={noop}
        />
      </GalleryState>
      {TONES.map((tone) => (
        <GalleryState key={tone} label={`Reminder — ${tone}`}>
          <Reminder
            icon={<PlaceholderIcon glyph="!" />}
            tone={tone}
            title="Ella's passport expires in 9 months"
            subtitle="12 June 2027 · renewals take about 10 weeks"
            ruleId="passport-expiry"
            ruleVersion="3"
            sourceReference="document 8f2c"
            primaryActionLabel="Renew now"
            onPrimaryAction={noop}
            secondaryActionLabel="Snooze"
            onSecondaryAction={noop}
          />
        </GalleryState>
      ))}
      <GalleryState label="NotFound">
        <NotFound
          icon={<PlaceholderIcon glyph="?" />}
          description="This document does not exist, or it is not in one of your families."
          actionLabel="Back to the vault"
          onAction={noop}
        />
      </GalleryState>
    </GallerySection>
  );
}
