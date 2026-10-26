export interface ConcernCategory {
  category_id: number;
  category_name: string;
}

export interface ConcernOffice {
  office_id: string;
  office_name: string;
  description?: string;
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
  created_at: string;
  updated_by?: string;
}

export interface ConcernWithRelations {
  // Internal Firebase document ID.
  concern_id: string;

  // Shared reference displayed to personnel.
  concern_number: number | null;

  // Permanent reference belonging to this resident.
  resident_concern_number: number | null;

  resident_id: string;
  assigned_personnel_id: string | null;

  office_id: string | null;
  office?: ConcernOffice;
  last_updated_by?: string | null;

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
  concern_number: number;
  resident_concern_number: number;
  message?: string;
}

export type Concern = ConcernWithRelations;