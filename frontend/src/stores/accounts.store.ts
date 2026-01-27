import { create } from 'zustand'
import type { GoogleAccount } from '../types'

interface AccountsState {
  accounts: Record<string, GoogleAccount>

  setAccounts: (accounts: GoogleAccount[]) => void
  addAccount: (account: GoogleAccount) => void
  removeAccount: (accountId: string) => void
  markNeedsReauth: (accountId: string) => void
  clearReauth: (accountId: string) => void
  getAccount: (accountId: string) => GoogleAccount | undefined
  getAllAccounts: () => GoogleAccount[]
}

function updateAccount(
  state: AccountsState,
  accountId: string,
  patch: Partial<GoogleAccount>
): Partial<AccountsState> {
  const account = state.accounts[accountId]
  if (!account) return {}
  return {
    accounts: {
      ...state.accounts,
      [accountId]: { ...account, ...patch },
    },
  }
}

export const useAccountsStore = create<AccountsState>()((set, get) => ({
  accounts: {},

  setAccounts: (accounts) =>
    set({
      accounts: Object.fromEntries(accounts.map((a) => [a.id, a])),
    }),

  addAccount: (account) =>
    set((state) => ({
      accounts: {
        ...state.accounts,
        [account.id]: account,
      },
    })),

  removeAccount: (accountId) =>
    set((state) => {
      const { [accountId]: _, ...rest } = state.accounts
      return { accounts: rest }
    }),

  markNeedsReauth: (accountId) =>
    set((state) => updateAccount(state, accountId, { needs_reauth: true })),

  clearReauth: (accountId) =>
    set((state) => updateAccount(state, accountId, { needs_reauth: false })),

  getAccount: (accountId) => get().accounts[accountId],

  getAllAccounts: () => Object.values(get().accounts),
}))
