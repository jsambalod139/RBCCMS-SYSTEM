export interface ConcernUpdate {
  update_id: number;
  concern_id: string | number;
  updated_by: string | number;
  previous_status: string | null;
  new_status: string;
  remarks: string | null;
  created_at: string;
}