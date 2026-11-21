import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { unauthenticated, validation } from './errors';

const USERNAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function normalizeUsername(raw: string): string | null {
  const username = raw.trim().toLowerCase();
  if (!USERNAME.test(username)) return null;
  return username;
}

export const Fan = createParamDecorator((required: boolean, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const header = request.header('x-fan-username');
  if (header == null || header.trim() === '') {
    if (required) throw unauthenticated();
    return null;
  }
  const username = normalizeUsername(header);
  if (!username) {
    throw validation(
      'Use letters, numbers, underscores, or hyphens, up to 32 characters.',
    );
  }
  return username;
});
