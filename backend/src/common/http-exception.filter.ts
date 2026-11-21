import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from './errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof DomainError) {
      response.status(exception.statusCode).json({
        statusCode: exception.statusCode,
        code: exception.code,
        message: exception.message,
        ...(exception.seatIds ? { seatIds: exception.seatIds } : {}),
      });
      return;
    }
    if (exception instanceof ZodError) {
      const message = exception.issues[0]?.message ?? 'Check the request and try again.';
      response.status(400).json({
        statusCode: 400,
        code: 'VALIDATION',
        message,
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : Array.isArray((raw as { message?: unknown }).message)
            ? String((raw as { message: unknown[] }).message[0])
            : String((raw as { message?: unknown }).message ?? exception.message);
      response.status(status).json({
        statusCode: status,
        code: status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION' : 'INTERNAL',
        message,
      });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(500).json({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
    });
  }
}
