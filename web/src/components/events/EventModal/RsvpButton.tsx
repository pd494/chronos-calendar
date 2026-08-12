import { useRef } from "react";
import ReactDOM from "react-dom";
import { ChevronDown } from "lucide-react";
import { RSVP_OPTIONS } from "./constants";

interface RsvpButtonProps {
  isOpen: boolean;
  onToggle: () => void;
  selfRsvpStatus: string;
}

export function RsvpButton({ isOpen, onToggle, selfRsvpStatus }: RsvpButtonProps) {
  const rsvpButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={rsvpButtonRef}
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm shrink-0 transition-colors ${
          selfRsvpStatus === "accepted"
            ? "text-green-700"
            : selfRsvpStatus === "declined"
              ? "text-red-600"
              : "text-gray-600"
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full ${
            selfRsvpStatus === "accepted"
              ? "bg-green-500"
              : selfRsvpStatus === "declined"
                ? "bg-red-500"
                : "bg-gray-400"
          }`}
        />
        <span className="whitespace-nowrap">
          {selfRsvpStatus === "accepted"
            ? "Going"
            : selfRsvpStatus === "declined"
              ? "Not going"
              : "Maybe"}
        </span>
        <ChevronDown size={14} />
      </button>
      {isOpen &&
        rsvpButtonRef.current &&
        ReactDOM.createPortal(
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 py-1 modal-fade-in"
            style={{
              width:
                rsvpButtonRef.current.getBoundingClientRect().width,
              bottom:
                window.innerHeight -
                rsvpButtonRef.current.getBoundingClientRect().top +
                8,
              left: rsvpButtonRef.current.getBoundingClientRect()
                .left,
            }}
          >
            {RSVP_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                  selfRsvpStatus === option.value ? "font-semibold" : ""
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
