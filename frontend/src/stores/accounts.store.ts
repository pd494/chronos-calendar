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

export const useAccountsStore = create<AccountsState>()((set, get) => ({
  accounts: {},

  setAccounts: (accounts) =>
    set({
      accounts: accounts.reduce(
        (acc, account) => {
          acc[account.id] = account
          return acc
        },
        {} as Record<string, GoogleAccount>
      ),
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
    set((state) => {
      const account = state.accounts[accountId]
      if (!account) return state
      return {
        accounts: {
          ...state.accounts,
          [accountId]: { ...account, needs_reauth: true },
        },
      }
    }),

  clearReauth: (accountId) =>
    set((state) => {
      const account = state.accounts[accountId]
      if (!account) return state
      return {
        accounts: {
          ...state.accounts,
          [accountId]: { ...account, needs_reauth: false },
        },
      }
    }),

  getAccount: (accountId) => get().accounts[accountId],

  getAllAccounts: () => Object.values(get().accounts),
}))
