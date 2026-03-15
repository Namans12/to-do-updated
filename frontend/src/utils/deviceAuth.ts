const DEVICE_AUTH_CREDENTIAL_ID_KEY = "nodes-device-auth-credential-id";
const DEVICE_AUTH_UNLOCKED_KEY = "nodes-device-auth-unlocked";

function randomBuffer(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function isDeviceAuthSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && "credentials" in navigator;
}

export function readStoredDeviceCredentialId() {
  return localStorage.getItem(DEVICE_AUTH_CREDENTIAL_ID_KEY);
}

export function isDeviceAuthConfigured() {
  return !!readStoredDeviceCredentialId();
}

export function isDeviceAuthUnlockedForSession() {
  return sessionStorage.getItem(DEVICE_AUTH_UNLOCKED_KEY) === "true";
}

export function markDeviceAuthUnlocked() {
  sessionStorage.setItem(DEVICE_AUTH_UNLOCKED_KEY, "true");
}

export function lockDeviceAuthSession() {
  sessionStorage.removeItem(DEVICE_AUTH_UNLOCKED_KEY);
}

export function clearStoredDeviceAuth() {
  localStorage.removeItem(DEVICE_AUTH_CREDENTIAL_ID_KEY);
  sessionStorage.removeItem(DEVICE_AUTH_UNLOCKED_KEY);
}

export async function enrollDeviceAuth(userLabel: string) {
  if (!isDeviceAuthSupported()) {
    throw new Error("Device authentication is not supported on this browser.");
  }

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: randomBuffer(),
    rp: {
      name: "Nodes To-Do",
      id: window.location.hostname,
    },
    user: {
      id: randomBuffer(16),
      name: `nodes-${userLabel || "device"}@local`,
      displayName: userLabel || "Nodes Device",
    },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    timeout: 60_000,
    attestation: "none",
  };

  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Device authentication setup was cancelled.");
  }

  const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
  localStorage.setItem(DEVICE_AUTH_CREDENTIAL_ID_KEY, credentialId);
  markDeviceAuthUnlocked();
  return credentialId;
}

export async function verifyDeviceAuth() {
  if (!isDeviceAuthSupported()) {
    throw new Error("Device authentication is not supported on this browser.");
  }

  const storedCredentialId = readStoredDeviceCredentialId();
  if (!storedCredentialId) {
    throw new Error("No device authentication credential is configured.");
  }

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBuffer(),
      allowCredentials: [
        {
          id: base64UrlToBytes(storedCredentialId),
          type: "public-key",
        },
      ],
      userVerification: "required",
      timeout: 60_000,
      rpId: window.location.hostname,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Device authentication was cancelled.");
  }

  markDeviceAuthUnlocked();
  return true;
}
