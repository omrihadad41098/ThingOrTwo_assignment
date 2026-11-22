import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { requireUuid } from '../common/ids';
import {
  ApiErrors,
  busy,
  eventMissing,
  fanRequired,
  holdForbidden,
  holdMissing,
} from '../common/openapi';
import { LONE_SEAT_MESSAGE } from './lone-seat';
import { HoldsService, holdBodySchema } from './holds.service';

@ApiTags('holds')
@ApiSecurity('fan')
@Controller()
export class HoldsController {
  constructor(private readonly holds: HoldsService) {}

  @Post('events/:eventId/holds')
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          required: ['seatIds'],
          properties: { seatIds: { type: 'array', items: { type: 'string' }, example: ['B2', 'B3'] } },
        },
        {
          type: 'object',
          required: ['bestAvailable'],
          properties: {
            bestAvailable: {
              type: 'object',
              required: ['count'],
              properties: {
                count: { type: 'integer', example: 2 },
                maxPriceAgorot: { type: 'integer' },
                zoneId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      ],
    },
  })
  @ApiCreatedResponse({ description: 'The new hold. Seat ids are canonical and sorted.' })
  @ApiErrors(
    ...fanRequired,
    { status: 400, code: 'VALIDATION', message: 'Send either seatIds or bestAvailable.' },
    { status: 400, code: 'VALIDATION', message: 'A hold is 1 to 4 seats.' },
    { status: 400, code: 'VALIDATION', message: 'Seat ids look like B7.' },
    {
      status: 400,
      code: 'VALIDATION',
      message: "B9 isn't a seat in this event.",
      seatIds: ['B9'],
    },
    eventMissing,
    {
      status: 409,
      code: 'NOT_ON_SALE',
      message: 'Tickets go on sale at 2026-12-01T18:00:00.000Z.',
    },
    {
      status: 409,
      code: 'LIMIT_EXCEEDED',
      message: 'You can only hold 4 seats for this show, and you already have 4.',
    },
    {
      status: 409,
      code: 'SEAT_UNAVAILABLE',
      message: 'Someone just took B7.',
      seatIds: ['B7'],
    },
    { status: 409, code: 'LONE_SEAT', message: LONE_SEAT_MESSAGE },
    {
      status: 409,
      code: 'NO_BLOCK',
      message: 'No 2 seats together are free in that price range.',
    },
    busy,
  )
  create(
    @Param('eventId') eventId: string,
    @Fan(true) username: string,
    @Body() body: unknown,
  ) {
    return this.holds.create(requireUuid(eventId, 'event'), username, holdBodySchema.parse(body));
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Released. A second release by the owner is also 200.' })
  @ApiErrors(
    ...fanRequired,
    holdMissing,
    holdForbidden,
    { status: 409, code: 'HOLD_CLOSED', message: 'These seats are already bought.' },
    {
      status: 409,
      code: 'HOLD_EXPIRED',
      message: 'Your hold has expired. These seats are back on sale.',
    },
    {
      status: 409,
      code: 'SEAT_UNAVAILABLE',
      message: 'Someone just took these seats.',
    },
    busy,
  )
  release(@Param('id') id: string, @Fan(true) username: string) {
    return this.holds.release(requireUuid(id, 'hold'), username);
  }
}
