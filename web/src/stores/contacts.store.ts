import { create } from 'zustand'

interface ContactsState {
  photoUrls: Record<string, string>
  setPhotoUrl: (email: string, photoUrl: string) => void
  addContacts: (contacts: { email: string; photoUrl: string | null }[]) => void
}

export const useContactsStore = create<ContactsState>((set) => ({
  photoUrls: {},
  setPhotoUrl: (email, photoUrl) =>
    set((state) => ({
      photoUrls: { ...state.photoUrls, [email.toLowerCase()]: photoUrl },
    })),
  addContacts: (contacts) =>
    set((state) => {
      const newPhotoUrls = { ...state.photoUrls }
      let changed = false
      for (const contact of contacts) {
        if (contact.photoUrl && newPhotoUrls[contact.email.toLowerCase()] !== contact.photoUrl) {
          newPhotoUrls[contact.email.toLowerCase()] = contact.photoUrl
          changed = true
        }
      }
      return changed ? { photoUrls: newPhotoUrls } : state
    }),
}))
