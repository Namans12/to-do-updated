export function getActionErrorMessage(action: string, error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return `Failed to ${action}`;
}
