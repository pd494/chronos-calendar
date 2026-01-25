import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ({}),
  text: async () => '',
})))
