import type { Clock } from '@fp/kernel';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
