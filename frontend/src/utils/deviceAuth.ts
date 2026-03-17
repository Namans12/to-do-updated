import { Capacitor } from "@capacitor/core";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";

const DEVICE_AUTH_CREDENTIAL_ID_KEY = "nodes-device-auth-credential-id";
const DEVICE_AUTH_NATIVE_ENABLED_KEY = "nodes-device-auth-native-enabled";
const DEVICE_AUTH_UNLOCKED_KEY = "nodes-device-auth-unlocked";

function isNativeDeviceAuthPlatform() {
  return Capacitor.isNativePlatform();
}

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

function isWebAuthnSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && "credentials" in navigator;
}

export function readStoredDeviceCredentialId() {
  return localStorage.getItem(DEVICE_AUTH_CREDENTIAL_ID_KEY);
}

function isNativeDeviceAuthConfigured() {
  return localStorage.getItem(DEVICE_AUTH_NATIVE_ENABLED_KEY) === "true";
}

export function isDeviceAuthSupported() {
  if (typeof window === "undefined") return false;
  return isNativeDeviceAuthPlatform() || isWebAuthnSupported();
}

export function isDeviceAuthConfigured() {
  if (typeof window === "undefined") return false;
  return isNativeDeviceAuthPlatform() ? isNativeDeviceAuthConfigured() : !!readStoredDeviceCredentialId();
}

export function isDeviceAuthUnlockedForSession() {
  if (typeof window === "undefined") return false;
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
  localStorage.removeItem(DEVICE_AUTH_NATIVE_ENABLED_KEY);
  sessionStorage.removeItem(DEVICE_AUTH_UNLOCKED_KEY);
}

async function enrollNativeDeviceAuth() {
  const availability = await BiometricAuth.checkBiometry();
  if (!availability.isAvailable && !availability.deviceIsSecure) {
    throw new Error("This device does not have biometric or screen-lock authentication enabled.");
  }

  await BiometricAuth.authenticate({
    reason: "Enable device unlock for Nodes",
    cancelTitle: "Cancel",
    allowDeviceCredential: true,
    iosFallbackTitle: "Use device passcode",
    androidTitle: "Enable device unlock",
    androidSubtitle: "Use your device security to unlock Nodes",
    androidConfirmationRequired: false,
  });

  localStorage.setItem(DEVICE_AUTH_NATIVE_ENABLED_KEY, "true");
  markDeviceAuthUnlocked();
  return "native-device-auth";
}

async function verifyNativeDeviceAuth() {
  if (!isNativeDeviceAuthConfigured()) {
    throw new Error("No device authentication is configured on this device.");
  }

  await BiometricAuth.authenticate({
    reason: "Unlock Nodes",
    cancelTitle: "Cancel",
    allowDeviceCredential: true,
    iosFallbackTitle: "Use device passcode",
    androidTitle: "Unlock Nodes",
    androidSubtitle: "Authenticate to open your workspace",
    androidConfirmationRequired: false,
  });

  markDeviceAuthUnlocked();
  return true;
}

async function enrollWebDeviceAuth(userLabel: string) {
  if (!isWebAuthnSupported()) {
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

async function verifyWebDeviceAuth() {
  if (!isWebAuthnSupported()) {
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

export async function enrollDeviceAuth(userLabel: string) {
  return isNativeDeviceAuthPlatform()
    ? enrollNativeDeviceAuth()
    : enrollWebDeviceAuth(userLabel);
}

export async function verifyDeviceAuth() {
  return isNativeDeviceAuthPlatform() ? verifyNativeDeviceAuth() : verifyWebDeviceAuth();
}
