interface DeleteButtonProps {
  showConfirm: boolean;
  onDeleteClick: (e: React.MouseEvent) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteButton({
  showConfirm,
  onDeleteClick,
  onConfirm,
  onCancel,
}: DeleteButtonProps) {
  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Delete?</span>
        <button
          type="button"
          onClick={onConfirm}
          className="px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onDeleteClick}
      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
    >
      Delete event
    </button>
  );
}
