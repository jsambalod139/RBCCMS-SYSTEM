import type { ConcernStatus } from './concern.model';

export interface ConcernUpdate {
  update_id: number;
  concern_id: string | number;
  updated_by: string | number;
  previous_status: ConcernStatus | null;
  new_status: ConcernStatus;
  remarks: string | null;
  created_at: string;
}