import { useCallback, useRef } from 'react'

export function useDeferredReorder(
  reorder: (newOrder: string[]) => void,
  persistReorder: (newOrder: string[]) => Promise<void>,
) {
  const pendingOrderRef = useRef<string[]>([])

  const handleReorder = useCallback((newOrder: string[]) => {
    pendingOrderRef.current = newOrder
    reorder(newOrder)
  }, [reorder])

  const handleReorderEnd = useCallback(() => {
    if (pendingOrderRef.current.length === 0) return
    const finalOrder = pendingOrderRef.current
    pendingOrderRef.current = []
    void persistReorder(finalOrder)
  }, [persistReorder])

  return { handleReorder, handleReorderEnd }
}
