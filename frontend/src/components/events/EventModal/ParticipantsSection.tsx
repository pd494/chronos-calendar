import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Users, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { EventFormData } from "../../../schemas/event.schema";
import { getParticipantColor, getInitials } from "./constants";

interface ParticipantsSectionProps {
  form: UseFormReturn<EventFormData>;
  isEditing: boolean;
  isNew: boolean | undefined;
  existingEvent: { organizer?: { email: string } } | undefined;
  watchedAttendees: { email: string; displayName?: string; responseStatus: string }[];
  attendeeSummary: string;
  isFormChanged: boolean;
}

export function ParticipantsSection({
  form,
  isEditing,
  isNew,
  existingEvent,
  watchedAttendees,
  attendeeSummary,
  isFormChanged,
}: ParticipantsSectionProps) {
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  return (
    <div className="px-4 py-2.5 border-b border-gray-100">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Users className="text-gray-400 mt-1 flex-shrink-0" size={20} />
          <div className="flex-1 space-y-2.5 min-w-0">
            <input
              type="email"
              value={participantEmail}
              readOnly={!isEditing && !isNew}
              onChange={(e) => setParticipantEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const email = participantEmail.trim().toLowerCase();
                  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    const current = form.getValues("attendees") ?? [];
                    if (
                      !current.some(
                        (a) => a.email.toLowerCase() === email,
                      )
                    ) {
                      form.setValue(
                        "attendees",
                        [
                          ...current,
                          { email, responseStatus: "needsAction" },
                        ],
                        { shouldDirty: true },
                      );
                      setParticipantEmail("");
                    }
                  }
                }
              }}
              onBlur={() => {
                const email = participantEmail.trim().toLowerCase();
                if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  const current = form.getValues("attendees") ?? [];
                  if (
                    !current.some((a) => a.email.toLowerCase() === email)
                  ) {
                    form.setValue(
                      "attendees",
                      [
                        ...current,
                        { email, responseStatus: "needsAction" },
                      ],
                      { shouldDirty: true },
                    );
                    setParticipantEmail("");
                  }
                }
              }}
              placeholder="Add guests"
              className="w-full px-0 py-1 text-sm text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-400"
            />
            {(watchedAttendees).length > 0 && (
              <div data-participants-section>
                {!participantsExpanded ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">
                          {watchedAttendees.length} guest
                          {watchedAttendees.length !== 1 ? "s" : ""} –
                        </span>
                        {attendeeSummary && (
                          <span className="ml-1">
                            {attendeeSummary}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParticipantsExpanded(true);
                        }}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors -mr-1"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {(watchedAttendees)
                        .slice(0, 5)
                        .map((attendee, i) => {
                          const isAccepted =
                            attendee.responseStatus === "accepted";
                          const isDeclined =
                            attendee.responseStatus === "declined";
                          return (
                            <div
                              key={attendee.email}
                              className="relative group"
                              style={{
                                marginLeft: i > 0 ? -8 : 0,
                                zIndex: 5 - i,
                              }}
                            >
                              <div
                                className="rounded-full text-xs font-semibold text-white flex items-center justify-center border-2 border-white"
                                style={{
                                  backgroundColor: getParticipantColor(
                                    attendee.email,
                                  ),
                                  width: 33.6,
                                  height: 33.6,
                                }}
                                title={
                                  attendee.displayName || attendee.email
                                }
                              >
                                {getInitials(attendee.email)}
                              </div>
                              {isAccepted && (
                                <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center border border-white">
                                  <Check
                                    size={10}
                                    className="text-white"
                                    strokeWidth={3}
                                  />
                                </div>
                              )}
                              {isDeclined && (
                                <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center border border-white">
                                  <X
                                    size={10}
                                    className="text-white"
                                    strokeWidth={3}
                                  />
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const list =
                                    form.getValues("attendees") ?? [];
                                  const idx = list.findIndex(
                                    (a) => a.email === attendee.email,
                                  );
                                  form.setValue(
                                    "attendees",
                                    list.filter((_, j) => j !== idx),
                                    { shouldDirty: true },
                                  );
                                }}
                                className="absolute -bottom-1 -right-1 w-4 h-4 bg-white hover:bg-red-50 rounded-full flex items-center justify-center border border-gray-300 hover:border-red-400 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-150 z-10"
                                aria-label={`Remove ${attendee.email}`}
                              >
                                <X
                                  size={10}
                                  className="text-gray-600 hover:text-red-600"
                                  strokeWidth={2.5}
                                />
                              </button>
                            </div>
                          );
                        })}
                      {(watchedAttendees).length > 5 && (
                        <div
                          className="rounded-full text-xs font-semibold bg-gray-200 text-gray-600 flex items-center justify-center border-2 border-white"
                          style={{
                            marginLeft: -5,
                            zIndex: 0,
                            width: 33.6,
                            height: 33.6,
                          }}
                        >
                          +{(watchedAttendees).length - 5}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">
                          {(watchedAttendees).length} guest
                          {(watchedAttendees).length !== 1
                            ? "s"
                            : ""}{" "}
                          –
                        </span>
                        {attendeeSummary && (
                          <span className="ml-1">
                            {attendeeSummary}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParticipantsExpanded(false);
                        }}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                      >
                        <ChevronUp size={16} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-0.5 custom-scrollbar overflow-y-auto max-h-[200px]">
                      {(watchedAttendees).map((attendee) => {
                        const isAccepted =
                          attendee.responseStatus === "accepted";
                        const isDeclined =
                          attendee.responseStatus === "declined";
                        const isOrganizer =
                          existingEvent?.organizer?.email ===
                          attendee.email;
                        return (
                          <div
                            key={attendee.email}
                            className="flex items-center gap-2 py-1.5 group min-h-[36px]"
                          >
                            <div className="relative flex-shrink-0">
                              <div
                                className="rounded-full text-xs font-semibold text-white flex items-center justify-center"
                                style={{
                                  backgroundColor: getParticipantColor(
                                    attendee.email,
                                  ),
                                  width: 28,
                                  height: 28,
                                }}
                              >
                                {getInitials(attendee.email)}
                              </div>
                              {isAccepted && (
                                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center border border-white">
                                  <Check
                                    size={8}
                                    className="text-white"
                                    strokeWidth={3}
                                  />
                                </div>
                              )}
                              {isDeclined && (
                                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center border border-white">
                                  <X
                                    size={8}
                                    className="text-white"
                                    strokeWidth={3}
                                  />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div
                                className={`text-sm text-gray-900 truncate ${isOrganizer ? "font-semibold" : ""}`}
                              >
                                {attendee.displayName || attendee.email}
                              </div>
                              {isOrganizer && (
                                <div className="text-xs text-gray-500">
                                  Organizer
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const list =
                                  form.getValues("attendees") ?? [];
                                const idx = list.findIndex(
                                  (a) => a.email === attendee.email,
                                );
                                form.setValue(
                                  "attendees",
                                  list.filter((_, j) => j !== idx),
                                  { shouldDirty: true },
                                );
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 rounded transition-all"
                              aria-label={`Remove ${attendee.email}`}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {(isEditing || isNew) && (
          <button
            type="submit"
            disabled={!isFormChanged}
            className={`flex-shrink-0 px-4 py-1.5 text-sm rounded-md font-medium whitespace-nowrap self-start ${
              !isFormChanged
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
          >
            {isNew ? "Create event" : "Update event"}
          </button>
        )}
      </div>
    </div>
  );
}
