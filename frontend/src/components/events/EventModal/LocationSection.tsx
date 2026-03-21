import { UseFormReturn } from "react-hook-form";
import { MapPin, Video } from "lucide-react";
import { EventFormData } from "../../../schemas/event.schema";

interface LocationSectionProps {
  form: UseFormReturn<EventFormData>;
  isEditing: boolean;
  isNew: boolean | undefined;
  locationLink: { type: "meeting" | "maps"; href: string } | null;
}

export function LocationSection({ form, isEditing, isNew, locationLink }: LocationSectionProps) {
  return (
    <div className="px-4 py-2.5 border-b border-gray-100">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="text-gray-400 flex-shrink-0" size={20} />
        <div className="flex-1 min-w-0">
          <input
            {...form.register("location")}
            readOnly={!isEditing && !isNew}
            placeholder="Add location or URL"
            className={`w-full px-0 py-1 text-sm text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-400 ${!isEditing && !isNew ? "cursor-default" : ""}`}
          />
        </div>
        {locationLink?.type === "meeting" && (
          <a
            href={locationLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs flex-shrink-0 bg-blue-500/80 text-white hover:bg-blue-600/80 border border-blue-500/50 origin-right"
            style={{ transform: "scale(0.85)" }}
          >
            <Video size={16} className="text-white" />
            <span className="hidden sm:inline">Join meeting</span>
          </a>
        )}
        {locationLink?.type === "maps" && (
          <a
            href={locationLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1.5 bg-white/80 border border-gray-200 rounded-lg hover:bg-white/90 text-xs text-gray-700 flex-shrink-0 origin-right"
            style={{ transform: "scale(0.85)" }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M12 2C8.13 2 5 5.13 5 9c0 4.75 3.75 9.1 6.5 11.36a1 1 0 001 0C15.25 18.1 19 13.75 19 9c0-3.87-3.13-7-7-7zm0 14c-2.76-2.5-5-6.02-5-7.5 0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.48-2.24 5-5 7.5zm0-10a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"
              />
            </svg>
            <span className="hidden sm:inline">Get directions</span>
          </a>
        )}
      </div>
    </div>
  );
}
