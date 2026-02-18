/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_BACKEND_URL?: string;
}

interface ChronosBridge {
  openExternal?: (url: string) => Promise<{ success: boolean } | void> | void;
  receiveDeepLink?: (url: string) => void;
  resolveOpenExternal?: (
    requestId: string,
    success: boolean,
    error?: string,
  ) => void;
  consumePendingDeepLinks?: () => string[];
}

interface Window {
  __ELECTROBUN__?: boolean;
  __chronos?: ChronosBridge;
}
