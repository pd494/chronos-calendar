/// <reference types="@testing-library/jest-dom" />
import React, { forwardRef, useImperativeHandle } from 'react'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarSync } from '../src/hooks/useCalendarSync'
import { useEventsLive } from '../src/hooks/useEventsLive'
import { db } from '../src/lib/db'
import { useSyncStore } from '../src/stores/sync.store'

class MockEventSource {
  static instances: MockEventSource[] = []
  static CLOSED = 2
  readyState = 1
  url: string
  listeners: Map<string, Array<(event: MessageEvent) => void | Promise<void>>> = new Map()
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void | Promise<void>) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void | Promise<void>) {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter((item) => item !== listener))
  }

  async emit(type: string, payload: unknown) {
    const list = this.listeners.get(type) ?? []
    const event = { data: JSON.stringify(payload) } as MessageEvent
    await Promise.all(list.map((listener) => Promise.resolve(listener(event))))
  }

  emitError() {
    this.onerror?.(new Event('error'))
  }

  close() {
    this.readyState = MockEventSource.CLOSED
  }
}

function buildEvent(id: string, calendarId: string) {
  const now = new Date()
  return {
    id,
    calendarId,
    summary: `Event ${id}`,
    start: { dateTime: now.toISOString() },
    end: { dateTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString() },
    status: 'confirmed' as const,
    visibility: 'default' as const,
    transparency: 'opaque' as const,
  }
}

function SyncHarness({ calendarIds, enabled = true }: { calendarIds: string[]; enabled?: boolean }) {
  const { progress, error } = useCalendarSync({
    calendarIds,
    enabled,
    pollInterval: 0,
  })
  const { events } = useEventsLive(calendarIds)

  return (
    <div>
      <div data-testid="event-count">{events.length}</div>
      <div data-testid="cal-complete">{progress.calendarsComplete}</div>
      {error && <div data-testid="error">{error}</div>}
    </div>
  )
}

const SyncRefHarness = forwardRef<
  { sync: () => Promise<void> },
  { calendarIds: string[]; enabled?: boolean }
>(function SyncRefHarness({ calendarIds, enabled = false }, ref) {
  const { sync } = useCalendarSync({
    calendarIds,
    enabled,
    pollInterval: 0,
  })

  useImperativeHandle(ref, () => ({ sync }))
  return null
})

beforeEach(async () => {
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  MockEventSource.instances = []
  await db.delete()
  await db.open()
  useSyncStore.setState({
    status: 'idle',
    error: null,
    syncingCalendarIds: [],
    shouldStop: false,
  })
})

afterEach(() => {
  cleanup()
})

describe('calendar SSE sync', () => {
  it('streams events into Dexie and updates live queries', async () => {
    render(<SyncHarness calendarIds={['cal-1', 'cal-2']} />)

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    const eventSource = MockEventSource.instances[0]

    await act(async () => {
      await eventSource.emit('events', {
        calendar_id: 'cal-1',
        events: [buildEvent('evt-1', 'cal-1')],
      })
    })

    await waitFor(() => expect(screen.getByTestId('event-count')).toHaveTextContent('1'))

    await act(async () => {
      await eventSource.emit('events', {
        calendar_id: 'cal-2',
        events: [buildEvent('evt-2', 'cal-2'), buildEvent('evt-3', 'cal-2')],
      })
    })

    await waitFor(() => expect(screen.getByTestId('event-count')).toHaveTextContent('3'))

    await act(async () => {
      await eventSource.emit('sync_token', { calendar_id: 'cal-1', token: 'token-1' })
      await eventSource.emit('sync_token', { calendar_id: 'cal-2', token: 'token-2' })
    })

    await waitFor(() => expect(screen.getByTestId('cal-complete')).toHaveTextContent('2'))

    await act(async () => {
      await eventSource.emit('complete', { total_events: 3, calendars_synced: 2 })
    })
  })

  it('does not open multiple SSE connections while sync is in-flight', async () => {
    const ref = React.createRef<{ sync: () => Promise<void> }>()
    render(<SyncRefHarness ref={ref} calendarIds={['cal-1']} />)

    let first: Promise<void> | undefined
    let second: Promise<void> | undefined

    await act(async () => {
      if (!ref.current) {
        throw new Error('Sync ref not ready')
      }
      first = ref.current.sync()
      second = ref.current.sync()
    })

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
  })

  it('surfaces non-retryable sync errors', async () => {
    render(<SyncHarness calendarIds={['cal-1']} />)

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))
    const eventSource = MockEventSource.instances[0]

    await act(async () => {
      await eventSource.emit('sync_error', {
        calendar_id: 'cal-1',
        code: '500',
        message: 'Boom',
        retryable: false,
      })
    })

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Boom'))
  })
})
