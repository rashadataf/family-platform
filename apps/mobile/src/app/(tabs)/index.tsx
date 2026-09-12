/**
 * Today (artboard 11), assembled from `@fp/ui` alone, with static sample
 * content — no network call (FR-027). This phase (US1) delivers the
 * schedule and tasks sections; the reminders section belongs to `Reminder`
 * (US3, T044), which does not exist yet — that is the one genuine
 * cross-story coupling this spec's tasks.md names, not an oversight here.
 *
 * T032 proves the point of everything built so far: every value on this
 * screen resolves through a token or a primitive prop, and there is
 * nowhere on this page a literal design value could hide.
 */
import { ScrollView, View } from 'react-native';
import { Card, EventRow, Header, TaskRow, space, useTheme } from '@fp/ui';
import { useState } from 'react';

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

export default function TodayScreen() {
  const { colours } = useTheme();
  const [tasks, setTasks] = useState(INITIAL_TASKS);

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
      </ScrollView>
    </View>
  );
}
