import { applyDecorators } from '@nestjs/common';
import { Matches, ValidateBy } from 'class-validator';
import { parseDay } from '../days';

const MESSAGE = 'Date invalide (AAAA-MM-JJ)';

/** A real calendar date written `YYYY-MM-DD`. */
export const IsDay = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MESSAGE }),
    ValidateBy({
      name: 'isDay',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && parseDay(value) !== null,
        defaultMessage: () => MESSAGE,
      },
    }),
  );
