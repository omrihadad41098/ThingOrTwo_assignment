import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Fan } from '../common/fan';
import { requireUuid } from '../common/ids';
import { ApiErrors, busy, fanRequired, holdForbidden, holdMissing } from '../common/openapi';
import { CheckoutService, checkoutBodySchema } from './checkout.service';

@ApiTags('checkout')
@ApiSecurity('fan')
@Controller('holds')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post(':id/checkout')
  @HttpCode(200)
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        promoCode: {
          type: 'string',
          example: 'SAVE10',
          description: 'Optional. SAVE10 or WELCOME20. Omit the field to pay full price.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Order, replayed with the same id when one already exists.' })
  @ApiErrors(
    ...fanRequired,
    holdMissing,
    holdForbidden,
    { status: 409, code: 'HOLD_CLOSED', message: 'This hold was released.' },
    {
      status: 409,
      code: 'HOLD_EXPIRED',
      message: 'Your hold has expired. These seats are back on sale.',
    },
    { status: 409, code: 'PROMO_INVALID', message: "That coupon code isn't valid." },
    { status: 409, code: 'PROMO_USED', message: 'WELCOME20 can only be used once.' },
    busy,
  )
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
