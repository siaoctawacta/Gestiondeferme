/** An omitted or empty text field stored as `null` (the one rule of every service that writes optional text). */
export const blank = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === '' ? null : value;
