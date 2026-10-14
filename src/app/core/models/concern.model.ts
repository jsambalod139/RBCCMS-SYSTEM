
import type { Category } from './category.model';
import type { ConcernUpdate } from './concern-update.model';

export type ConcernStatus =
  | 'Pending'
  | 'In Progress'
  | 'Resolved'
  | 'Rejected';

export interface Concern {
  concern_id: number;
  resident_id: number;
  category_id: number;
  office_id: number | null;
  description: string;
  location_description: string;
  current_status: ConcernStatus;
  reported_at: string;
  updated_at: string | null;

  // Optional frontend display properties
  category?: Category;
  category_name?: string;
  updates?: ConcernUpdate[];
}

export type ConcernWithRelations = Concern;
