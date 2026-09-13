/**
 * Today (artboard 11), assembled from `@fp/ui` alone, with static sample
 * content — no network call (FR-027). T044 completes the screen US1 left
 * partial: the reminders section below uses the `Reminder` pattern from
 * US3, which is the one genuine cross-story coupling this spec's
 * tasks.md names, not an oversight.
 *
 * T032 proves the point of everything built so far: every value on this
 * screen resolves through a token or a primitive prop, and there is
 * nowhere on this page a literal design value could hide.
 */
import { ScrollView, View } from 'react-native';
import { Card, EventRow, Header, Reminder, TaskRow, space, useTheme } from '@fp/ui';
import { useState } from 'react';
import { PlaceholderIcon } from '../../components/placeholder-icon.js';

const SCHEDULE = [
  {
    categoryId: 'ella',
    time: '15:30',
    duration: '45m',
    title: 'Nursery pickup',
    subtitle: 'Bluebell Nursery · Rashad',
    participants: [{ memberId: 'rashad', initials: 'R' }],
  },
  {
    categoryId: 'ella',
    time: '17:00',
    duration: '1h',
    title: 'Swimming',
    subtitle: 'Leisure centre · Ella, Sami',
    participants: [
      { memberId: 'ella', initials: 'E' },
      { memberId: 'sami', initials: 'S' },
    ],
  },
];

const INITIAL_TASKS = [
  {
    id: 'dentist',
    title: 'Book dentist for Ella',
    subtitle: 'Due Friday · Rashad',
    done: false,
    assignee: { memberId: 'rashad', initials: 'R' },
  },
  {
    id: 'shoes',
    title: 'Order school shoes',
    subtitle: 'Done yesterday',
    done: true,
    assignee: { memberId: 'ada', initials: 'A' },
  },
];

const REMINDERS = [
  {
    id: 'passport',
    tone: 'caution' as const,
    title: "Ella's passport expires in 9 months",
    subtitle: '12 June 2027 · renewals take about 10 weeks',
    ruleId: 'passport-expiry',
    ruleVersion: '3',
    sourceReference: 'document 8f2c',
  },
  {
    id: 'mot',
    tone: 'info' as const,
    title: 'MOT due in 4 weeks',
    subtitle: 'Vehicle KX21 ORP · 9 October',
    ruleId: 'mot-expiry',
    ruleVersion: '1',
    sourceReference: 'document 3a91',
  },
];

export default function TodayScreen() {
  const { colours } = useTheme();
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [reminders, setReminders] = useState(REMINDERS);

  return (
    <View style={{ flex: 1, backgroundColor: colours['surface.canvas'] }}>
      <Header variant="large" title="Thursday" subtitle="12 September · 4 things today" />
      <ScrollView contentContainerStyle={{ gap: space[6], padding: space[4] }}>
        <Card>
          {SCHEDULE.map((event, index) => (
            <EventRow key={event.title} {...event} isLast={index === SCHEDULE.length - 1} />
          ))}
        </Card>
        <Card>
          {tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              title={task.title}
              subtitle={task.subtitle}
              done={task.done}
              assignee={task.assignee}
              isLast={index === tasks.length - 1}
              onToggle={() => {
                setTasks((current) =>
                  current.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)),
                );
              }}
            />
          ))}
        </Card>
        <View style={{ gap: space[3] }}>
          {reminders.map((reminder) => (
            <Reminder
              key={reminder.id}
              icon={<PlaceholderIcon glyph="!" />}
              tone={reminder.tone}
              title={reminder.title}
              subtitle={reminder.subtitle}
              ruleId={reminder.ruleId}
              ruleVersion={reminder.ruleVersion}
              sourceReference={reminder.sourceReference}
              primaryActionLabel="Renew now"
              onPrimaryAction={() => {
                setReminders((current) => current.filter((r) => r.id !== reminder.id));
              }}
              secondaryActionLabel="Snooze"
              onSecondaryAction={() => {
                setReminders((current) => current.filter((r) => r.id !== reminder.id));
              }}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
