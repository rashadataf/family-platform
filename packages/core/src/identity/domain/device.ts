import type { DeviceId, UserId } from '@fp/kernel';

export interface DeviceProps {
  id: DeviceId;
  userId: UserId;
  label: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Deliberately minimal (FR-009, spec.md): a client-supplied label only — no
 * IP address, user agent, or hardware identifier. This is not a
 * fingerprinting or tracking mechanism, so it carries nothing beyond what a
 * user needs to recognise "which of my sessions is this" (Principle VI: no
 * field without a purpose).
 */
export class Device {
  private constructor(private props: DeviceProps) {}

  static register(params: { id: DeviceId; userId: UserId; label: string; now: Date }): Device {
    return new Device({
      id: params.id,
      userId: params.userId,
      label: params.label,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
    });
  }

  static reconstitute(props: DeviceProps): Device {
    return new Device(props);
  }

  get id(): DeviceId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get label(): string {
    return this.props.label;
  }

  get firstSeenAt(): Date {
    return this.props.firstSeenAt;
  }

  get lastSeenAt(): Date {
    return this.props.lastSeenAt;
  }

  toProps(): Readonly<DeviceProps> {
    return { ...this.props };
  }
}
