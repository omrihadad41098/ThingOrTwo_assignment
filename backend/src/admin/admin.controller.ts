import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @ApiOkResponse({ description: 'Fans, newest first. A fan row is created when they hold a seat.' })
  listUsers() {
    return this.admin.listUsers();
  }

  @Delete('users/:username')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Deletes the fan and frees seats from their holds and orders.' })
  deleteUser(@Param('username') username: string) {
    return this.admin.deleteUser(username);
  }

  @Delete('events/:id')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Deletes the show and its seats, holds, and orders.' })
  deleteEvent(@Param('id') id: string) {
    return this.admin.deleteEvent(id);
  }
}
