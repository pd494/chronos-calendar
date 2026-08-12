import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DexieContact } from '../lib/db'
import { googleApi, type Contact } from '../api/google'

export async function hydrateContacts(): Promise<void> {
  const { contacts } = await googleApi.getContactDirectory()
  const incoming = new Map(
    contacts
      .filter((c) => c.displayName)
      .map((c) => [c.email.toLowerCase(), { displayName: c.displayName!, photoUrl: c.photoUrl ?? undefined }] as const),
  )

  await db.transaction('rw', db.contacts, async () => {
    const existing = await db.contacts.toArray()
    const existingMap = new Map(existing.map((c) => [c.email, c]))

    const toAdd: DexieContact[] = []
    const toUpdate: DexieContact[] = []
    for (const [email, data] of incoming) {
      const ex = existingMap.get(email)
      if (!ex) {
        toAdd.push({ email, displayName: data.displayName, photoUrl: data.photoUrl })
      } else if (ex.displayName !== data.displayName || ex.photoUrl !== data.photoUrl) {
        toUpdate.push({ ...ex, displayName: data.displayName, photoUrl: data.photoUrl })
      }
    }

    const toDelete = existing
      .filter((c) => !incoming.has(c.email))
      .map((c) => c.id!)

    if (toDelete.length) await db.contacts.bulkDelete(toDelete)
    if (toAdd.length) await db.contacts.bulkAdd(toAdd)
    if (toUpdate.length) await db.contacts.bulkPut(toUpdate)
  })
}

export function useContactsHydrate(): void {
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    hydrateContacts().catch((err) => console.error('contacts hydration failed:', err))
  }, [])
}

function useDebouncedValue(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export interface ContactMatch {
  email: string
  displayName: string
  photoUrl?: string
}

export function useContactSearch(query: string): {
  contacts: ContactMatch[]
  allContacts: DexieContact[]
  workspacePending: boolean
} {
  const all = useLiveQuery(() => db.contacts.toArray(), []) ?? []
  const debounced = useDebouncedValue(query, 150)
  const [workspaceResults, setWorkspaceResults] = useState<ContactMatch[]>([])
  const [workspacePending, setWorkspacePending] = useState(false)

  useEffect(() => {
    if (debounced.length < 2) {
      setWorkspaceResults([])
      setWorkspacePending(false)
      return
    }
    let cancelled = false
    setWorkspacePending(true)
    googleApi.searchWorkspace(debounced)
      .then((r) => {
        if (!cancelled) {
          setWorkspaceResults(
            r.contacts
              .filter((c): c is Contact & { displayName: string } => !!c.displayName)
              .map((c) => ({
                email: c.email.toLowerCase(),
                displayName: c.displayName,
                photoUrl: c.photoUrl ?? undefined,
              })),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setWorkspaceResults([])
      })
      .finally(() => {
        if (!cancelled) setWorkspacePending(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const contacts = useMemo(() => {
    if (query.length < 2) return []

    const q = query.toLowerCase().trim()
    const qCompact = q.replace(/\s+/g, '')

    const matchesContact = (c: DexieContact) => {
      const email = c.email.toLowerCase()
      const name = c.displayName.toLowerCase()
      const nameCompact = name.replace(/\s+/g, '')
      const localPart = email.split('@')[0] ?? ''
      return (
        email.includes(q) ||
        name.includes(q) ||
        (qCompact.length >= 2 && nameCompact.includes(qCompact)) ||
        localPart.includes(q)
      )
    }

    const local: ContactMatch[] = all.filter(matchesContact)

    const localEmails = new Set(local.map((c) => c.email))
    return [
      ...local,
      ...workspaceResults.filter((c) => !localEmails.has(c.email)),
    ]
  }, [query, all, workspaceResults])

  return { contacts, allContacts: all, workspacePending }
}
