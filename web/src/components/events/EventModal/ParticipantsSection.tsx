import { useState, useRef, useLayoutEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { UseFormReturn } from "react-hook-form";
import { Users, Check, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { EventFormData } from "../../../schemas/event.schema";
import { getParticipantColor, getInitials } from "./constants";
import { useContactSearch } from "../../../hooks/useContacts";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { getApiUrl } from "../../../api/client";
import { useContactsStore } from "../../../stores";
import { googleApi } from "../../../api/google";

interface ParticipantsSectionProps {
  modalRef: RefObject<HTMLDivElement | null>;
  form: UseFormReturn<EventFormData>;
  isEditing: boolean;
  isNew: boolean | undefined;
  existingEvent: { organizer?: { email: string } } | undefined;
  watchedAttendees: { email: string; displayName?: string; photoUrl?: string; responseStatus: string }[];
  attendeeSummary: string;
  isFormChanged: boolean;
}

export function ParticipantsSection({
  modalRef,
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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null!);
  const inputRowRef = useRef<HTMLDivElement>(null);
  const [suggestionsPanelRect, setSuggestionsPanelRect] = useState<{
    bottom: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const photoUrls = useContactsStore((s) => s.photoUrls);
  const [groupMembers, setGroupMembers] = useState<Record<string, { email: string; role: string }[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loadingGroups, setLoadingGroups] = useState<Set<string>>(new Set());

  const toggleGroup = async (groupEmail: string) => {
    if (expandedGroups.has(groupEmail)) {
      setExpandedGroups((prev) => { const next = new Set(prev); next.delete(groupEmail); return next; });
      return;
    }
    if (!groupMembers[groupEmail]) {
      setLoadingGroups((prev) => new Set(prev).add(groupEmail));
      try {
        const { members } = await googleApi.getGroupMembers(groupEmail);
        setGroupMembers((prev) => ({ ...prev, [groupEmail]: members }));
      } catch {
        setGroupMembers((prev) => ({ ...prev, [groupEmail]: [] }));
      } finally {
        setLoadingGroups((prev) => { const next = new Set(prev); next.delete(groupEmail); return next; });
      }
    }
    setExpandedGroups((prev) => new Set(prev).add(groupEmail));
  };
  useClickOutside(suggestionsRef, (e) => {
    if ((e.target as Element).closest('[data-suggestions-portal]')) return;
    setShowSuggestions(false);
  }, showSuggestions);

    const addParticipant = (email: string, displayName?: string, photoUrl?: string) => {
      const normalized = email.trim().toLowerCase();
      const current = form.getValues("attendees") ?? [];
      if (current.some((a) => a.email.toLowerCase() === normalized)) {
        setParticipantEmail("");
        // Do not close suggestions modal here
        return;
      }

      const match = !displayName || !photoUrl
        ? contacts.find((c) => c.email === normalized) ?? allContacts.find((c) => c.email === normalized)
        : undefined;

      const cachedPhoto = photoUrls[normalized];
      const finalName = displayName ?? match?.displayName ?? undefined;
      const finalPhoto = photoUrl ?? match?.photoUrl ?? cachedPhoto ?? undefined;

      form.setValue(
        "attendees",
        [...current, { email: normalized, displayName: finalName, photoUrl: finalPhoto, responseStatus: "needsAction" }],
        { shouldDirty: true },
      );

      setParticipantEmail("");
      // Keep suggestions open
      // setShowSuggestions(false);
    };

  const { contacts, allContacts, workspacePending } = useContactSearch(participantEmail);
  const existingEmails = new Set(
    (form.getValues("attendees") ?? []).map((a) => a.email.toLowerCase()),
  );
  const filteredContacts = contacts.filter(
    (c) => !existingEmails.has(c.email),
  );

  const trimmedParticipantQuery = participantEmail.trim();
  const suggestionsOpen =
    showSuggestions && trimmedParticipantQuery.length >= 2 && filteredContacts.length > 0;

  useLayoutEffect(() => {
    if (!suggestionsOpen) {
      return;
    }

    const updateRect = () => {
      const modalEl = modalRef.current;
      const inputRowEl = inputRowRef.current;
      if (!modalEl || !inputRowEl) return;

      const m = modalEl.getBoundingClientRect();
      const inputTop = inputRowEl.getBoundingClientRect().top;
      const gap = 8;
      
      setSuggestionsPanelRect({
        bottom: window.innerHeight - inputTop + gap,
        left: m.left - 1, // Offset for the border
        width: m.width + 2, // Widen for the border
        maxHeight: 290, // Cap at ~5 items
      });
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [suggestionsOpen, modalRef, watchedAttendees.length, isEditing, isNew]);

  const isGroupEmail = (email: string) => email.includes("-group@") || email.includes("-list@") || email.includes("group@");

  const renderAttendeeRow = (attendee: typeof watchedAttendees[0]) => {
    const isAccepted = attendee.responseStatus === "accepted";
    const isDeclined = attendee.responseStatus === "declined";
    const isOrganizer = existingEvent?.organizer?.email === attendee.email;
    const photoUrl = attendee.photoUrl || photoUrls[attendee.email.toLowerCase()];
    const isGroup = isGroupEmail(attendee.email);
    const isExpanded = expandedGroups.has(attendee.email);
    const isLoading = loadingGroups.has(attendee.email);
    const members = groupMembers[attendee.email];

    return (
      <div key={attendee.email}>
        <div className="flex items-center gap-1.5 py-1 group min-h-[30px]">
          <div className="relative flex-shrink-0">
            {isGroup ? (
              <div
                className="rounded-full flex items-center justify-center"
                style={{ backgroundColor: getParticipantColor(attendee.email), width: 23, height: 23 }}
              >
                <Users size={12} className="text-white" />
              </div>
            ) : (
              <>
                {photoUrl ? (
                  <img
                    src={photoUrl.startsWith("http") ? photoUrl : `${getApiUrl()}${photoUrl}`}
                    alt=""
                    className="rounded-full object-cover"
                    style={{ width: 23, height: 23 }}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const sibling = e.currentTarget.nextElementSibling as HTMLElement;
                      if (sibling) sibling.classList.remove("hidden");
                    }}
                  />
                ) : null}
                <div
                  className={`rounded-full text-[9px] font-semibold text-white flex items-center justify-center ${photoUrl ? "hidden" : ""}`}
                  style={{ backgroundColor: getParticipantColor(attendee.email), width: 23, height: 23 }}
                >
                  {getInitials(attendee.email)}
                </div>
              </>
            )}
            {isAccepted && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full flex items-center justify-center border border-white">
                <Check size={6} className="text-white" strokeWidth={3} />
              </div>
            )}
            {isDeclined && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full flex items-center justify-center border border-white">
                <X size={6} className="text-white" strokeWidth={3} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[13px] text-gray-900 truncate ${isOrganizer ? "font-semibold" : ""}`}>
              {attendee.displayName || attendee.email}
              {isGroup && members && (
                <span className="text-gray-400 font-normal ml-1">({members.length})</span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 truncate leading-tight">
              {attendee.displayName ? attendee.email : ""}{isOrganizer ? (attendee.displayName ? " (Organizer)" : "Organizer") : ""}
            </div>
          </div>
          {isGroup && (
            <button
              type="button"
              onClick={() => toggleGroup(attendee.email)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              {isLoading ? (
                <div className="w-3 h-3 border-[1.5px] border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown size={14} />
                </motion.div>
              )}
            </button>
          )}
          {(isEditing || isNew) && (
            <button
              type="button"
              onClick={() => {
                const list = form.getValues("attendees") ?? [];
                const idx = list.findIndex((a) => a.email === attendee.email);
                form.setValue("attendees", list.filter((_, j) => j !== idx), { shouldDirty: true });
              }}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 rounded transition-all"
              aria-label={`Remove ${attendee.email}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <AnimatePresence>
          {isGroup && isExpanded && members && members.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {members.map((m) => {
                const contact = allContacts.find((c) => c.email === m.email);
                const memberPhoto = photoUrls[m.email];
                return (
                  <div key={m.email} className="flex items-center gap-1.5 py-0.5 pl-6 min-h-[26px]">
                    <div className="relative flex-shrink-0">
                      {(contact?.photoUrl || memberPhoto) ? (
                        <img
                          src={(() => { const url = contact?.photoUrl || memberPhoto!; return url.startsWith("http") ? url : `${getApiUrl()}${url}`; })()}
                          alt=""
                          className="rounded-full object-cover"
                          style={{ width: 19, height: 19 }}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const sibling = e.currentTarget.nextElementSibling as HTMLElement;
                            if (sibling) sibling.classList.remove("hidden");
                          }}
                        />
                      ) : null}
                      <div
                        className={`rounded-full text-[8px] font-semibold text-white flex items-center justify-center ${(contact?.photoUrl || memberPhoto) ? "hidden" : ""}`}
                        style={{ backgroundColor: getParticipantColor(m.email), width: 19, height: 19 }}
                      >
                        {getInitials(m.email)}
                      </div>
                    </div>
                    <div className="text-[12px] text-gray-600 truncate">
                      {contact?.displayName || m.email}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const attendeeList = (
    <div className="flex flex-col gap-0.5 custom-scrollbar-thin overflow-y-auto max-h-[200px]">
      {watchedAttendees.map((attendee) => renderAttendeeRow(attendee))}
    </div>
  );

  return (
    <div className="relative px-4 py-2 border-b border-gray-100" ref={suggestionsRef}>
      <div ref={inputRowRef} className="flex items-center justify-between gap-3 relative z-[10]">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Users className="text-gray-400 flex-shrink-0" size={18} />
          <div className="relative flex-1 min-w-0">
            <input
              type="email"
              value={participantEmail}
              readOnly={!isEditing && !isNew}
              onChange={(e) => {
                setParticipantEmail(e.target.value);
                setShowSuggestions(e.target.value.length >= 2);
              }}
              onFocus={() => {
                if (participantEmail.length >= 2) setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const email = participantEmail.trim().toLowerCase();
                  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    addParticipant(email);
                  }
                }
                if (e.key === "Escape") {
                  setShowSuggestions(false);
                }
              }}
              onBlur={() => {
                const email = participantEmail.trim().toLowerCase();
                if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  addParticipant(email);
                }
              }}
              placeholder=""
              className="w-full px-0 py-0.5 text-[13px] text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 relative z-[1]"
            />
            {!participantEmail && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 mt-[1px] text-[13px] text-gray-400 pointer-events-none">
                Add guests
              </div>
            )}
          </div>
        </div>
        {(isEditing || isNew) && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {workspacePending && filteredContacts.length === 0 && participantEmail.trim().length >= 2 && (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
            )}
            <button
              type="submit"
              disabled={!isFormChanged}
              className={`px-4 py-1.5 text-sm rounded-md font-medium whitespace-nowrap ${
                !isFormChanged
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-green-600 text-white hover:bg-green-700"
              }`}
            >
              {isNew ? "Create event" : "Update event"}
            </button>
          </div>
        )}
      </div>
      {suggestionsOpen && createPortal(
          <AnimatePresence>
            {suggestionsOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="fixed z-[5000] bg-white border border-gray-100 rounded-[22px] flex flex-col overflow-hidden pointer-events-auto shadow-[0_20px_50px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.05)]"
                data-suggestions-portal="true"
                style={
                  suggestionsPanelRect
                    ? {
                        bottom: suggestionsPanelRect.bottom,
                        left: suggestionsPanelRect.left,
                        width: suggestionsPanelRect.width,
                        maxHeight: suggestionsPanelRect.maxHeight,
                      }
                    : {
                        visibility: "hidden",
                        pointerEvents: "none",
                        bottom: 0,
                        left: 0,
                        width: 0,
                        height: 0,
                      }
                }
              >
                <div className="flex items-center justify-between px-3 pt-2 pb-1 bg-white shrink-0">
                  <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1">
                    Suggested Contacts
                  </div>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent input blur which causes jumpiness
                      setShowSuggestions(false);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div
                  className={`flex-1 min-h-0 flex flex-col p-1.5 pt-0 ${
                    filteredContacts.length >= 4
                      ? "overflow-y-auto custom-scrollbar-thin-rounded pr-0.5"
                      : filteredContacts.length === 0
                        ? "items-center justify-center overflow-hidden px-4 min-h-[60px]"
                        : "overflow-hidden"
                  }`}
                >
                  {filteredContacts.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-sm text-gray-500">
                      {workspacePending ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                          <span>Searching…</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    filteredContacts.map((contact) => (
                      <button
                        key={contact.email}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // keep focus on the input
                          e.stopPropagation(); // prevent modal from closing
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          addParticipant(contact.email, contact.displayName, contact.photoUrl);
                        }}
                        className="w-full shrink-0 transition-colors hover:bg-gray-100/80 rounded-[16px] flex items-center gap-3 p-2 text-left group"
                      >
                        {contact.photoUrl ? (
                          <img
                            src={contact.photoUrl.startsWith("http") ? contact.photoUrl : `${getApiUrl()}${contact.photoUrl}`}
                            alt=""
                            className="w-[34px] h-[34px] rounded-full flex-shrink-0 object-cover shadow-[0_2px_4px_rgba(0,0,0,0.06)]"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                              if (fallback) fallback.classList.remove("hidden");
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                        <div
                          className={`w-[34px] h-[34px] text-[13px] rounded-full flex-shrink-0 flex items-center justify-center font-semibold text-white shadow-[0_2px_4px_rgba(0,0,0,0.06)] ${contact.photoUrl ? "hidden" : ""}`}
                          style={{ backgroundColor: getParticipantColor(contact.email) }}
                        >
                          {getInitials(contact.email)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] text-gray-900 font-semibold truncate leading-snug">
                            {contact.displayName}
                          </div>
                          <div className="text-[12px] text-gray-500 truncate leading-snug">
                            {contact.email}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      {watchedAttendees.length > 0 && (
        <div data-participants-section className="mt-2">
          {watchedAttendees.length <= 5 ? (
            <AnimatePresence mode="wait">
              <motion.div
                key="list-only"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              >
                {attendeeList}
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setParticipantsExpanded(!participantsExpanded);
                }}
                className="flex items-center w-full text-gray-500 hover:text-gray-700 transition-colors group mb-1 min-h-[24px] relative"
              >
                <div className="flex items-center flex-1 relative min-h-[24px]">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {!participantsExpanded ? (
                      <motion.div
                        key="collapsed"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="flex items-center gap-2"
                      >
                        <div className="flex items-center">
                          {watchedAttendees.slice(0, 5).map((a, i) => {
                            const photoUrl = a.photoUrl || photoUrls[a.email.toLowerCase()];
                            return (
                              <div key={a.email} className="relative rounded-full border border-white" style={{ marginLeft: i > 0 ? -7 : 0, zIndex: 5 - i }}>
                                {photoUrl ? (
                                  <img src={photoUrl.startsWith("http") ? photoUrl : `${getApiUrl()}${photoUrl}`} alt="" className="rounded-full object-cover" style={{ width: 18, height: 18 }} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove("hidden"); }} />
                                ) : null}
                                <div className={`rounded-full text-[8px] font-semibold text-white flex items-center justify-center ${photoUrl ? "hidden" : ""}`} style={{ backgroundColor: getParticipantColor(a.email), width: 18, height: 18 }}>
                                  {getInitials(a.email)}
                                </div>
                              </div>
                            );
                          })}
                          {watchedAttendees.length > 5 && (
                            <div className="rounded-full text-[8px] font-semibold bg-gray-200 text-gray-600 flex items-center justify-center border border-white" style={{ marginLeft: 2, zIndex: 0, width: 18, height: 18 }}>
                              +{watchedAttendees.length - 5}
                            </div>
                          )}
                        </div>
                        <span className="text-[13px] font-semibold text-gray-600 truncate">
                          {attendeeSummary || `${watchedAttendees.length} guests`}
                        </span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="expanded"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="flex items-center"
                      >
                        <span className="text-[13px] font-semibold text-gray-600 truncate">
                          {attendeeSummary || `${watchedAttendees.length} guests`}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                <div className="flex-shrink-0 ml-auto">
                  <motion.div
                    animate={{ rotate: participantsExpanded ? 180 : 0 }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                  >
                    <ChevronDown size={18} className="text-gray-400" />
                  </motion.div>
                </div>
              </button>

              <AnimatePresence>
                {participantsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="pt-1 pb-2">
                      {attendeeList}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
