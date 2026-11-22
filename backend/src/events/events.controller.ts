import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { requireUuid } from '../common/ids';
import { ApiErrors, busy, createEventBody, eventMissing, fanOptional } from '../common/openapi';
import { EventsService, createEventSchema } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @ApiBody({ schema: createEventBody })
  @ApiCreatedResponse({ description: 'Event, zones, and seatCount.' })
  @ApiErrors(
    {
      status: 400,
      code: 'VALIDATION',
      message: 'The drop must be before the show starts.',
    },
    {
      status: 400,
      code: 'VALIDATION',
      message: 'Zones must cover every row exactly once.',
    },
    busy,
  )
  create(@Body() body: unknown) {
    return this.events.create(createEventSchema.parse(body));
  }

  @Get()
  @ApiOkResponse({ description: 'Events sharing one serverNow.' })
  @ApiErrors(busy)
  list() {
    return this.events.list();
  }

  @Get(':id/map')
  @ApiOkResponse({ description: 'Seat map. Fan header is optional and does not create a user.' })
  @ApiErrors(...fanOptional, eventMissing, busy)
  map(@Param('id') id: string, @Fan(false) username: string | null) {
    return this.events.map(requireUuid(id, 'event'), username);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One event and its zones.' })
  @ApiErrors(eventMissing, busy)
  get(@Param('id') id: string) {
    return this.events.get(requireUuid(id, 'event'));
  }
}
