export interface GoogleAccount {
  id: string
  email: string
  name: string
  needs_reauth: boolean
}

export interface GoogleCalendar {
  id: string
  google_calendar_id: string
  name: string
  color: string
  is_primary: boolean
  access_role: 'owner' | 'writer' | 'reader'
  google_account_id: string
  account_email: string
  account_name: string
  needs_reauth: boolean
}

export interface SyncStatus {
  calendar_id: string
  has_sync_token: boolean
  fetched_ranges: { start_date: string; end_date: string }[]
}

export interface SyncResult {
  status: string
  upserted: number
  deleted: number
  sync_type?: string
}
