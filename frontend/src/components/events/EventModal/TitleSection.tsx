import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { UseFormReturn } from "react-hook-form";
import { Check } from "lucide-react";
import { EventFormData } from "../../../schemas/event.schema";
import {
  DESCRIPTION_LINE_HEIGHT,
  MAX_DESCRIPTION_PREVIEW_HEIGHT,
  linkifyText,
} from "./constants";

interface TitleSectionProps {
  form: UseFormReturn<EventFormData>;
  isEditing: boolean;
  isNew: boolean | undefined;
  existingEvent: {
    completed?: boolean;
    start: { dateTime?: string; date?: string };
    googleCalendarId: string;
    recurringEventId?: string;
    googleEventId: string;
  } | undefined;
  optimisticCompleted: boolean | null;
  setOptimisticCompleted: (value: boolean | null) => void;
  completionTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  toggleCompletion: {
    mutate: (params: {
      google_calendar_id: string;
      master_event_id: string;
      instance_start: string;
      completed: boolean;
    }) => void;
  };
  watchedDescription: string | undefined;
  watchedSummary: string | undefined;
  activeEventId: string | null;
  titleInputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  descriptionInputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}

export function TitleSection({
  form,
  isEditing,
  isNew,
  existingEvent,
  optimisticCompleted,
  setOptimisticCompleted,
  completionTimerRef,
  toggleCompletion,
  watchedDescription,
  watchedSummary,
  activeEventId,
  titleInputRef,
  descriptionInputRef,
}: TitleSectionProps) {
  const descriptionOverlayRef = useRef<HTMLDivElement | null>(null);
  const descriptionMeasureRef = useRef<HTMLDivElement>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [descriptionOverflowing, setDescriptionOverflowing] = useState(false);
  const [isDescriptionFocused, setIsDescriptionFocused] = useState(false);

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [activeEventId]);

  useEffect(() => {
    const measureEl = descriptionMeasureRef.current;
    if (!measureEl) return;
    const canExpand = measureEl.scrollHeight > MAX_DESCRIPTION_PREVIEW_HEIGHT;
    setDescriptionOverflowing(canExpand);
    if (!canExpand && isDescriptionExpanded) setIsDescriptionExpanded(false);
  }, [watchedDescription, isDescriptionExpanded]);

  useLayoutEffect(() => {
    const textarea = descriptionInputRef.current;
    if (!textarea) return;
    if (!isDescriptionFocused && watchedDescription) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [watchedDescription, isDescriptionFocused, descriptionInputRef]);

  useLayoutEffect(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    const frame = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(frame);
  }, [watchedSummary, activeEventId, titleInputRef]);

  const { ref: registerSummaryRef, ...summaryRegisterProps } =
    form.register("summary");
  const summaryRef = (e: HTMLTextAreaElement | null) => {
    if (typeof registerSummaryRef === "function") {
      registerSummaryRef(e);
    }
    if (e) {
      titleInputRef.current = e;
    }
  };

  const { ref: registerDescriptionRef, ...descriptionRegisterProps } =
    form.register("description");
  const descriptionRef = (e: HTMLTextAreaElement | null) => {
    if (typeof registerDescriptionRef === "function") {
      registerDescriptionRef(e);
    }
    if (e) {
      descriptionInputRef.current = e;
    }
  };

  return (
    <div
      className={`px-4 pt-[14px] ${(watchedDescription || descriptionOverflowing) && descriptionOverflowing ? "pb-2" : "pb-0"}`}
      style={{
        paddingBottom:
          !watchedDescription && !descriptionOverflowing
            ? 5
            : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        {!isNew && existingEvent && (() => {
          const isChecked = optimisticCompleted ?? existingEvent.completed;
          return (
            <button
              type="button"
              onClick={() => {
                const next = !isChecked;
                setOptimisticCompleted(next);
                if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
                completionTimerRef.current = setTimeout(() => {
                  const instanceStart =
                    existingEvent.start.dateTime ??
                    existingEvent.start.date ??
                    "";
                  const masterId =
                    existingEvent.recurringEventId ?? existingEvent.googleEventId;
                  toggleCompletion.mutate({
                    google_calendar_id: existingEvent.googleCalendarId,
                    master_event_id: masterId,
                    instance_start: instanceStart,
                    completed: next,
                  });
                }, 250);
              }}
              className={`w-[20px] h-[20px] flex items-center justify-center border-2 rounded-[6px] mt-[8px] transition-transform duration-75 ${
                isChecked
                  ? "border-green-500 bg-green-500 text-white scale-110"
                  : "border-gray-300 text-transparent hover:border-green-400 scale-90"
              }`}
            >
              <Check size={14} />
            </button>
          );
        })()}
        <div className="flex-1 min-w-0 pr-9">
          <textarea
            {...summaryRegisterProps}
            ref={summaryRef}
            readOnly={!isEditing && !isNew}
            placeholder="New event"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
              }
            }}
            className={`w-full px-0 pt-1 pb-[2px] text-xl font-semibold text-gray-900 border-none focus:outline-none focus:ring-0 placeholder-gray-400 bg-transparent resize-none overflow-hidden ${!isEditing && !isNew ? "cursor-default" : ""}`}
          />
          <div className="relative">
            <div
              ref={descriptionMeasureRef}
              aria-hidden="true"
              className="text-sm whitespace-pre-wrap break-words"
              style={{
                position: "absolute",
                visibility: "hidden",
                width: "100%",
                lineHeight: `${DESCRIPTION_LINE_HEIGHT}px`,
                padding: 0,
                pointerEvents: "none",
              }}
            >
              {watchedDescription}
            </div>

            {!isDescriptionFocused && watchedDescription ? (
              <>
                <div
                  ref={descriptionOverlayRef}
                  className="text-sm text-gray-500 whitespace-pre-wrap break-words cursor-text"
                  style={{
                    lineHeight: `${DESCRIPTION_LINE_HEIGHT}px`,
                    ...(!descriptionOverflowing ? { paddingBottom: 4 } : {}),
                    ...(isDescriptionExpanded
                      ? { maxHeight: 320, overflowY: "auto" as const }
                      : {
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical" as const,
                          overflow: "hidden",
                        }),
                  }}
                  onClick={() => descriptionInputRef.current?.focus()}
                >
                  {linkifyText(watchedDescription ?? "").map(
                    (part, i) =>
                      typeof part === "string" ? (
                        <span key={i}>{part}</span>
                      ) : (
                        <a
                          key={i}
                          href={part.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {part.url}
                        </a>
                      ),
                  )}
                </div>
                {descriptionOverflowing && !isDescriptionExpanded && (
                  <div className="mt-1 pb-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDescriptionExpanded(true);
                      }}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      See more
                    </button>
                  </div>
                )}
                {descriptionOverflowing && isDescriptionExpanded && (
                  <div className="mt-1 pb-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDescriptionExpanded(false);
                        if (descriptionOverlayRef.current) {
                          descriptionOverlayRef.current.scrollTop = 0;
                        }
                      }}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer p-1 -m-1"
                    >
                      See less
                    </button>
                  </div>
                )}
              </>
            ) : null}

            <textarea
              {...descriptionRegisterProps}
              ref={descriptionRef}
              readOnly={!isEditing && !isNew}
              placeholder="Add description"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                }
              }}
              onFocus={() => setIsDescriptionFocused(true)}
              onBlur={() => setIsDescriptionFocused(false)}
              className="w-full px-0 py-0 text-sm text-gray-500 border-none focus:outline-none focus:ring-0 resize-none bg-transparent placeholder-gray-400 custom-scrollbar-thin"
              style={{
                lineHeight: `${DESCRIPTION_LINE_HEIGHT}px`,
                ...(!isDescriptionFocused && watchedDescription
                  ? {
                      position: "absolute" as const,
                      opacity: 0,
                      height: 0,
                      overflow: "hidden",
                      pointerEvents: "none" as const,
                    }
                  : {}),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
