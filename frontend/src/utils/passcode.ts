const PASSCODE_HASH_KEY = "nodes-todo-passcode-hash";
const PASSCODE_UNLOCKED_KEY = "nodes-todo-passcode-unlocked";

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPasscode(passcode: string) {
  return sha256(passcode);
}

export function readStoredPasscodeHash() {
  return localStorage.getItem(PASSCODE_HASH_KEY);
}

export function storePasscodeHash(hash: string) {
  localStorage.setItem(PASSCODE_HASH_KEY, hash);
}

export function clearStoredPasscode() {
  localStorage.removeItem(PASSCODE_HASH_KEY);
  sessionStorage.removeItem(PASSCODE_UNLOCKED_KEY);
}

export function isPasscodeUnlockedForSession() {
  return sessionStorage.getItem(PASSCODE_UNLOCKED_KEY) === "true";
}

export function markPasscodeUnlocked() {
  sessionStorage.setItem(PASSCODE_UNLOCKED_KEY, "true");
}

export function lockPasscodeSession() {
  sessionStorage.removeItem(PASSCODE_UNLOCKED_KEY);
}

export async function verifyPasscode(passcode: string) {
  const stored = readStoredPasscodeHash();
  if (!stored) return false;
  const hash = await hashPasscode(passcode);
  return stored === hash;
}
