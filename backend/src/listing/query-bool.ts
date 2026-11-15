import { Transform } from 'class-transformer';

/** `?active=true|false` → boolean (anything else fails validation). */
export const QueryBool = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );
