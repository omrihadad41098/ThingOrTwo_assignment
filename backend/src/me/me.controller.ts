import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { MeService } from './me.service';

@ApiTags('me')
@ApiSecurity('fan')
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('holds')
  @ApiOkResponse({ description: 'Live holds for this fan. An unknown username returns an empty list.' })
  holds(@Fan(true) username: string) {
    return this.me.holds(username);
  }

  @Get('orders')
  @ApiOkResponse({ description: 'Orders, newest first.' })
  orders(@Fan(true) username: string) {
    return this.me.orders(username);
  }
}
