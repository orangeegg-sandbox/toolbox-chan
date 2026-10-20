export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const formatTime = (date: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
