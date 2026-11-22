import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

const errorSchema = {
  type: 'object',
  required: ['statusCode', 'code', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    code: { type: 'string' },
    message: { type: 'string' },
    seatIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Present when the error names specific seats.',
    },
  },
};

export type ApiErrorExample = {
  status: number;
  code: string;
  message: string;
  seatIds?: string[];
};

export const fanRequired: ApiErrorExample[] = [
  {
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Tell us who you are with the X-Fan-Username header.',
  },
  {
    status: 400,
    code: 'VALIDATION',
    message: 'Use letters, numbers, underscores, or hyphens, up to 32 characters.',
  },
];

export const fanOptional: ApiErrorExample[] = [fanRequired[1]];

export const busy: ApiErrorExample = {
  status: 503,
  code: 'BUSY',
  message: 'Too many people are trying for these seats. Please try again.',
};

export const eventMissing: ApiErrorExample = {
  status: 404,
  code: 'NOT_FOUND',
  message: "We couldn't find that event.",
};

export const holdMissing: ApiErrorExample = {
  status: 404,
  code: 'NOT_FOUND',
  message: "We couldn't find that hold.",
};

export const holdForbidden: ApiErrorExample = {
  status: 403,
  code: 'FORBIDDEN',
  message: 'This hold belongs to another fan.',
};

/** One OpenAPI response per status, with an example for each error code. */
export function ApiErrors(...examples: ApiErrorExample[]): MethodDecorator {
  const byStatus = new Map<number, ApiErrorExample[]>();
  for (const example of examples) {
    const group = byStatus.get(example.status) ?? [];
    group.push(example);
    byStatus.set(example.status, group);
  }
  const decorators = [...byStatus.entries()].map(([status, group]) =>
    ApiResponse({
      status,
      description: group.map((item) => `${item.code}: ${item.message}`).join(' '),
      content: {
        'application/json': {
          schema: errorSchema,
          examples: Object.fromEntries(
            group.map((item, index) => [
              `${item.code}-${index + 1}`,
              {
                summary: item.code,
                value: {
                  statusCode: item.status,
                  code: item.code,
                  message: item.message,
                  ...(item.seatIds ? { seatIds: item.seatIds } : {}),
                },
              },
            ]),
          ),
        },
      },
    }),
  );
  return applyDecorators(...decorators);
}

export const createEventBody = {
  type: 'object',
  required: ['name', 'venue', 'startsAt', 'dropAt', 'rowCount', 'seatsPerRow', 'zones'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120, example: 'Late Show' },
    venue: { type: 'string', minLength: 1, maxLength: 120, example: 'The Rialto' },
    startsAt: { type: 'string', format: 'date-time', example: '2026-12-22T19:00:00.000Z' },
    dropAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-12-01T18:00:00.000Z',
      description: 'Must be before startsAt.',
    },
    rowCount: { type: 'integer', minimum: 1, maximum: 60, example: 8 },
    seatsPerRow: { type: 'integer', minimum: 1, maximum: 100, example: 12 },
    zones: {
      type: 'array',
      minItems: 1,
      description: 'Rows A, B, C… Row A is nearest the stage. Zones cover every row once.',
      items: {
        type: 'object',
        required: ['name', 'fromRow', 'toRow', 'priceAgorot'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80, example: 'Stalls' },
          fromRow: { type: 'string', example: 'A' },
          toRow: { type: 'string', example: 'C' },
          priceAgorot: {
            type: 'integer',
            minimum: 0,
            example: 15000,
            description: 'Price of one seat in this zone, in agorot.',
          },
        },
      },
    },
  },
};
