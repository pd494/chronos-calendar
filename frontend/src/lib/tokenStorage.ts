import { isDesktop } from "./platform";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

let serviceName: string | null = null;

type KeyringApi = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (
    service: string,
    account: string,
    password: string,
  ) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<void>;
};

let keyringApiPromise: Promise<KeyringApi | null> | null = null;

async function getKeyringApi(): Promise<KeyringApi | null> {
  if (!isDesktop()) return null;
  if (!keyringApiPromise) {
    keyringApiPromise = import("tauri-plugin-keyring-api")
      .then((m) => ({
        getPassword: m.getPassword,
        setPassword: m.setPassword,
        deletePassword: m.deletePassword,
      }))
      .catch(() => null);
  }
  return keyringApiPromise;
}

export async function initTokenStorage(): Promise<void> {
  if (!isDesktop()) return;
  if (serviceName) return;
  const { getIdentifier } = await import("@tauri-apps/api/app");
  serviceName = (await getIdentifier()) || "chronos";
}

function requireServiceName(): string {
  if (!isDesktop()) return "chronos";
  if (!serviceName) {
    throw new Error(
      "initTokenStorage() must be called before using tokenStorage",
    );
  }
  return serviceName;
}

export async function getAccessToken(): Promise<string | null> {
  const service = requireServiceName();
  const keyring = await getKeyringApi();
  if (!keyring) return null;
  return await keyring.getPassword(service, ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  const service = requireServiceName();
  const keyring = await getKeyringApi();
  if (!keyring) return null;
  return await keyring.getPassword(service, REFRESH_TOKEN_KEY);
}

export async function setAccessToken(token: string): Promise<void> {
  const service = requireServiceName();
  const keyring = await getKeyringApi();
  if (!keyring) return;
  await keyring.setPassword(service, ACCESS_TOKEN_KEY, token);
}

export async function setRefreshToken(token: string): Promise<void> {
  const service = requireServiceName();
  const keyring = await getKeyringApi();
  if (!keyring) return;
  await keyring.setPassword(service, REFRESH_TOKEN_KEY, token);
}

export async function deleteAccessToken(): Promise<void> {
  const service = requireServiceName();
  const keyring = await getKeyringApi();
  if (!keyring) return;
  await keyring.deletePassword(service, ACCESS_TOKEN_KEY);
}

export async function deleteRefreshToken(): Promise<void> {
  const service = requireServiceName();
  const keyring = await getKeyringApi();
  if (!keyring) return;
  await keyring.deletePassword(service, REFRESH_TOKEN_KEY);
}
