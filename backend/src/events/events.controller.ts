import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { requireUuid } from '../common/ids';
import { EventsService, createEventSchema } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @ApiCreatedResponse({ description: 'Event, zones, and seatCount.' })
  create(@Body() body: unknown) {
    return this.events.create(createEventSchema.parse(body));
  }

  @Get()
  @ApiOkResponse({ description: 'Events sharing one serverNow.' })
  list() {
    return this.events.list();
  }

  @Get(':id/map')
  @ApiOkResponse({ description: 'Seat map. Fan header is optional and does not create a user.' })
  map(@Param('id') id: string, @Fan(false) username: string | null) {
    return this.events.map(requireUuid(id, 'event'), username);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One event and its zones.' })
  get(@Param('id') id: string) {
    return this.events.get(requireUuid(id, 'event'));
  }
}
