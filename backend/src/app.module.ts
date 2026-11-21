import { Module } from '@nestjs/common';
import { loadEnv } from './config/env';
import { Database } from './db/database';
import { HealthController } from './health.controller';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { HoldsController } from './holds/holds.controller';
import { HoldsService } from './holds/holds.service';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { Sweeper } from './sweeper/sweeper';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';

@Module({
  controllers: [
    HealthController,
    EventsController,
    HoldsController,
    CheckoutController,
    MeController,
    AdminController,
  ],
  providers: [
    {
      provide: Database,
      useFactory: () => new Database(loadEnv()),
    },
    EventsService,
    HoldsService,
    CheckoutService,
    MeService,
    AdminService,
    Sweeper,
  ],
})
export class AppModule {}
