/**
 * Artboard 07 — every row type, each alongside its own skeleton form
 * (FR-020, FR-028).
 */
import { useState } from 'react';
import {
  Card,
  DocumentRow,
  DocumentRowSkeleton,
  EventRow,
  EventRowSkeleton,
  MemberRow,
  MemberRowSkeleton,
  TaskRow,
  TaskRowSkeleton,
  type StatusPillStatus,
} from '@fp/ui';
import { GallerySection, GalleryState } from '../section.js';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const STATUSES: readonly StatusPillStatus[] = [
  'positive',
  'caution',
  'critical',
  'info',
  'proposed',
];

export function RowsSection() {
  const [taskDone, setTaskDone] = useState(false);

  return (
    <GallerySection title="Rows" note="Four row types, each with a matching skeleton anatomy.">
      <GalleryState label="EventRow">
        <Card>
          <EventRow
            categoryId="ella"
            time="15:30"
            duration="45m"
            title="Nursery pickup"
            subtitle="Bluebell Nursery · Rashad"
            participants={[{ memberId: 'rashad', initials: 'R' }]}
            isLast
          />
        </Card>
      </GalleryState>
      <GalleryState label="EventRowSkeleton">
        <Card>
          <EventRowSkeleton isLast />
        </Card>
      </GalleryState>
      <GalleryState label="TaskRow">
        <Card>
          <TaskRow
            title="Book dentist for Ella"
            subtitle="Due Friday · Rashad"
            done={taskDone}
            assignee={{ memberId: 'rashad', initials: 'R' }}
            onToggle={() => {
              setTaskDone((current) => !current);
            }}
            isLast
          />
        </Card>
      </GalleryState>
      <GalleryState label="TaskRowSkeleton">
        <Card>
          <TaskRowSkeleton isLast />
        </Card>
      </GalleryState>
      {STATUSES.map((status) => (
        <GalleryState key={status} label={`DocumentRow — ${status}`}>
          <Card>
            <DocumentRow
              icon={<PlaceholderIcon glyph="#" />}
              status={status}
              title="Passport"
              subtitle="Expires 12 June 2027"
              statusLabel={status}
              isLast
            />
          </Card>
        </GalleryState>
      ))}
      <GalleryState label="DocumentRowSkeleton">
        <Card>
          <DocumentRowSkeleton isLast />
        </Card>
      </GalleryState>
      <GalleryState label="MemberRow">
        <Card>
          <MemberRow
            member={{ memberId: 'ella', initials: 'E' }}
            name="Ella"
            roleSummary="Child · age 7"
            badge={{ icon: <PlaceholderIcon glyph="!" />, label: 'Guardians' }}
            isLast
          />
        </Card>
      </GalleryState>
      <GalleryState label="MemberRowSkeleton">
        <Card>
          <MemberRowSkeleton isLast />
        </Card>
      </GalleryState>
    </GallerySection>
  );
}
