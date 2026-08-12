import type { RecurrenceEditScope } from "../../../types";

interface RecurrenceScopeDialogProps {
  action: "edit" | "delete";
  allowedScopes: RecurrenceEditScope[];
  onSelect: (scope: RecurrenceEditScope) => void;
  onCancel: () => void;
  warningText?: string | null;
}

const SCOPE_OPTIONS: { scope: RecurrenceEditScope; label: string }[] = [
  { scope: "this", label: "This event" },
  { scope: "following", label: "This and following events" },
  { scope: "all", label: "All events" },
];

export function RecurrenceScopeDialog({
  action,
  allowedScopes,
  onSelect,
  onCancel,
  warningText,
}: RecurrenceScopeDialogProps) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="px-3 text-xs font-medium text-gray-500">
        {action === "edit" ? "Edit recurring event" : "Delete recurring event"}
      </span>
      {SCOPE_OPTIONS.filter(({ scope }) => allowedScopes.includes(scope)).map(({ scope, label }) => (
        <button
          key={scope}
          type="button"
          onClick={() => onSelect(scope)}
          className="w-full px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
        >
          {label}
        </button>
      ))}
      {warningText ? (
        <div className="px-3 py-1 text-xs text-amber-700">
          {warningText}
        </div>
      ) : null}
      <div className="mx-2 my-1 border-t border-gray-100" />
      <button
        type="button"
        onClick={onCancel}
        className="w-full px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-50 rounded-lg transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
