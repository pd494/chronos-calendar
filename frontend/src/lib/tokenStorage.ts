import {
  getPassword,
  setPassword,
  deletePassword,
} from "tauri-plugin-keyring-api";
import { isDesktop } from "./platform";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

let serviceName: string | null = null;

export async function initTokenStorage(): Promise<void> {
  if (!isDesktop()) return;
  if (serviceName) return;
  const { getIdentifier } = await import("@tauri-apps/api/app");
  serviceName = (await getIdentifier()) || "chronos";
}

function requireServiceName(): string {
  if (!isDesktop()) {
    throw new Error("tokenStorage can only be used in the desktop app");
  }
  if (!serviceName) {
    throw new Error(
      "initTokenStorage() must be called before using tokenStorage",
    );
  }
  return serviceName;
}

export async function getAccessToken(): Promise<string | null> {
  const service = requireServiceName();
  return await getPassword(service, ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  const service = requireServiceName();
  return await getPassword(service, REFRESH_TOKEN_KEY);
}

export async function setAccessToken(token: string): Promise<void> {
  const service = requireServiceName();
  await setPassword(service, ACCESS_TOKEN_KEY, token);
}

export async function setRefreshToken(token: string): Promise<void> {
  const service = requireServiceName();
  await setPassword(service, REFRESH_TOKEN_KEY, token);
}

export async function deleteAccessToken(): Promise<void> {
  const service = requireServiceName();
  await deletePassword(service, ACCESS_TOKEN_KEY);
}

export async function deleteRefreshToken(): Promise<void> {
  const service = requireServiceName();
  await deletePassword(service, REFRESH_TOKEN_KEY);
}
