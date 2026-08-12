import { useRef } from "react";
import ReactDOM from "react-dom";
import { Check } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { EventFormData } from "../../../schemas/event.schema";
import { EventColor, EVENT_COLORS } from "../../../types";
import { COLOR_OPTIONS } from "./constants";

interface ColorPickerProps {
  form: UseFormReturn<EventFormData>;
  isOpen: boolean;
  onToggle: () => void;
  watchedColor: EventColor;
  colors: (typeof EVENT_COLORS)[EventColor];
}

export function ColorPicker({ form, isOpen, onToggle, watchedColor, colors }: ColorPickerProps) {
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <button
        ref={colorButtonRef}
        type="button"
        onClick={onToggle}
        className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-gray-200 transition-colors hover:scale-110"
        style={{ backgroundColor: colors.border }}
      />
      {isOpen &&
        colorButtonRef.current &&
        ReactDOM.createPortal(
          <div
            ref={colorRef}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[9999] w-[120px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_10px_50px_rgba(0,0,0,0.15)] modal-fade-in"
            style={{
              bottom:
                window.innerHeight -
                colorButtonRef.current.getBoundingClientRect().top +
                8,
              left: colorButtonRef.current.getBoundingClientRect().left,
            }}
          >
            <div className="custom-scrollbar max-h-80 overflow-y-auto py-1">
              {COLOR_OPTIONS.map(([colorKey, colorValue]) => (
                <button
                  key={colorKey}
                  type="button"
                  onClick={() => {
                    form.setValue("color", colorKey, {
                      shouldDirty: true,
                    });
                    onToggle();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-900 transition-colors hover:bg-gray-50"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorValue.border }}
                  />
                  <span className="flex-1 text-[13px] leading-none capitalize truncate">
                    {colorKey}
                  </span>
                  {watchedColor === colorKey && (
                    <Check
                      size={14}
                      className="text-gray-500 flex-shrink-0"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
