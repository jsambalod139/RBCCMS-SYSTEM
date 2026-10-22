export interface ConcernCategory {
  category_id: number;
  category_name: string;
}

export interface ConcernPayload {
  category_id: number;
  location_description: string;
  description: string;
}

export type ConcernStatus = 'Pending' | 'In Progress' | 'Resolved' | 'Rejected';

export interface ConcernUpdate {
  update_id: number;
  previous_status: ConcernStatus | null;
  new_status: ConcernStatus;
  remarks: string | null;
  created_at: string;
  updated_by?: string;
}

export interface ConcernWithRelations {
  concern_id: string;
  resident_id: string;
  assigned_personnel_id: string | null;
  category_id: number;
  category?: ConcernCategory;
  location_description: string;
  description: string;
  photo_url?: string | null;
  photo_path?: string | null;
  current_status: ConcernStatus;
  reported_at: string;
  updated_at: string | null;
  updates: ConcernUpdate[];
}

export interface ConcernResponse {
  concern_id: string;
  message?: string;
}

export type Concern = ConcernWithRelations;
