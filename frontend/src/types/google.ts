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
