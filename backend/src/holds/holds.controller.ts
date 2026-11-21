import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { requireUuid } from '../common/ids';
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
  release(@Param('id') id: string, @Fan(true) username: string) {
    return this.holds.release(requireUuid(id, 'hold'), username);
  }
}
