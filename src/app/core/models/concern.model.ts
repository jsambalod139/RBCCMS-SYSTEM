export interface ConcernCategory {
  category_id: number;
  category_name: string;
}

export interface ConcernPayload {
  category_id: number;
  location_description: string;
  description: string;
}

export type ConcernStatus =
  | 'Pending'
  | 'In Progress'
  | 'Resolved'
  | 'Rejected';

export interface ConcernUpdate {
  update_id: number;
  previous_status: ConcernStatus | null;
  new_status: ConcernStatus;
  remarks: string | null;
  created_at: string; // ISO date string
}

export interface ConcernWithRelations {
  concern_id: string;
  category_id: number;
  category?: ConcernCategory;
  location_description: string;
  description: string;
  photo_url?: string | null;
  current_status: ConcernStatus;
  reported_at: string; // ISO date string
  updated_at: string | null;
  updates: ConcernUpdate[];
}

export interface ConcernResponse {
  concern_id: string;
  message?: string;
}

/** Alias so existing code can keep using `Concern`. */
export type Concern = ConcernWithRelations;