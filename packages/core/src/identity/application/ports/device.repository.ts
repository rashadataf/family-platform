import type { DeviceId } from '@fp/kernel';
import type { Device } from '../../domain/device.js';

export interface DeviceRepository {
  findById(id: DeviceId): Promise<Device | null>;
  save(device: Device): Promise<void>;
}
