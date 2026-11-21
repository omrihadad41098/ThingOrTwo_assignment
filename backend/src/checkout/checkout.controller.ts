import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { requireUuid } from '../common/ids';
import { CheckoutService, checkoutBodySchema } from './checkout.service';

@ApiTags('checkout')
@ApiSecurity('fan')
@Controller('holds')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post(':id/checkout')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      properties: { promoCode: { type: 'string', example: 'SAVE10' } },
    },
  })
  @ApiOkResponse({ description: 'Order, replayed with the same id when one already exists.' })
  buy(
    @Param('id') id: string,
    @Fan(true) username: string,
    @Body() body: unknown,
  ) {
    const parsed = checkoutBodySchema.parse(body ?? {});
    const promo = parsed.promoCode?.trim() ?? '';
    return this.checkout.checkout(requireUuid(id, 'hold'), username, promo === '' ? null : promo);
  }
}
