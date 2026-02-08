import { useRef, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Calendar, CalendarHeader } from "./components/calendar";
import { TodoSidebar, CategoryTabs } from "./components/todo";
import { EventModal } from "./components/events";
import { SettingsModal } from "./components/settings";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { Login } from "./pages/Login";
import { AuthCallback } from "./pages/AuthCallback";
import { useCalendarStore } from "./stores";
import { EventsProvider } from "./contexts/EventsContext";
import { useDesktopDeepLink } from "./hooks/useDesktopDeepLink";

function MainApp() {
  const {
    sidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
    showSettings,
  } = useCalendarStore();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const headerTabsRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarRef.current
        ? sidebarRef.current.getBoundingClientRect().width
        : sidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const newW = Math.max(
          200,
          Math.min(500, startW + (moveEvent.clientX - startX)),
        );
        if (sidebarRef.current) {
          sidebarRef.current.style.width = `${newW}px`;
        }
        if (headerTabsRef.current) {
          headerTabsRef.current.style.width = `${newW}px`;
        }
      };

      const onMouseUp = () => {
        const finalW = sidebarRef.current
          ? sidebarRef.current.getBoundingClientRect().width
          : sidebarWidth;
        const normalized = Math.max(200, Math.min(500, finalW));
        setSidebarWidth(normalized);

        if (normalized < 200 && sidebarOpen) {
          toggleSidebar();
        }

        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarOpen, sidebarWidth, setSidebarWidth, toggleSidebar],
  );

  return (
    <div className="h-screen flex flex-col bg-white text-gray-900">
      <div className="flex w-full border-b border-[#e5e5ea] flex-shrink-0 items-center bg-white h-12 min-h-12">
        {sidebarOpen && (
          <div
            ref={headerTabsRef}
            className="flex-shrink-0 flex items-center bg-white overflow-hidden border-r border-gray-200 h-12 min-h-12 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden whitespace-nowrap pl-0 transition-[width] duration-300 ease-in-out"
            style={{ width: `${sidebarWidth}px` }}
          >
            <CategoryTabs />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <CalendarHeader />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {sidebarOpen && (
          <div
            ref={sidebarRef}
            className="h-full relative flex-shrink-0 border-r border-gray-200 overflow-hidden"
            style={{ width: `${sidebarWidth}px` }}
          >
            <TodoSidebar />
            <div
              onMouseDown={startDrag}
              className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize z-20 hover:bg-purple-500/20 transition-colors"
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <Calendar />
        </div>
      </div>

      <EventModal />
      {showSettings && <SettingsModal />}
    </div>
  );
}

function App() {
  useDesktopDeepLink();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <EventsProvider>
              <MainApp />
            </EventsProvider>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
