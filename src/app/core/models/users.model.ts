export interface PersonnelProfile {
  user_id?: string | number;
  role_id?: string | number;
  office_id?: string | number | null;
  name?: string | null;
  email?: string | null;
  account_status?: string | null;
  created_at?: string | Date | null;
  role_name?: string | null;
}