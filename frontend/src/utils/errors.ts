export function getActionErrorMessage(action: string, error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("auth-token") || lowerMessage.includes("lock broken")) {
      return "Live sync is still starting up. Please wait a moment and try again.";
    }
    if (
      lowerMessage.includes("sign in to use live sync") ||
      lowerMessage.includes("jwt") ||
      lowerMessage.includes("refresh token") ||
      lowerMessage.includes("session")
    ) {
      return "Your live sync session needs attention. Sign in again and retry.";
    }
    if (
      lowerMessage.includes("column") ||
      lowerMessage.includes("relation") ||
      lowerMessage.includes("does not exist") ||
      lowerMessage.includes("schema")
    ) {
      return "Your Supabase schema is out of date. Re-run the latest schema and retry.";
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return `Failed to ${action}`;
}
