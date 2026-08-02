import type { ApiErrorResponse, FieldIssue } from '@monhorus/shared';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Error as MongooseError, mongo } from 'mongoose';
import { ZodError } from 'zod';

import { AppError } from '../common/errors/app-error';
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from '../common/errors/error-codes';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { zodIssuesToFieldIssues } from './validate.middleware';

interface NormalisedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  issues?: FieldIssue[];
}

function normalise(error: unknown): NormalisedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: ERROR_MESSAGES.VALIDATION_ERROR,
      issues: zodIssuesToFieldIssues(error),
    };
  }

  if (error instanceof MongooseError.ValidationError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: ERROR_MESSAGES.VALIDATION_ERROR,
      issues: Object.values(error.errors).map((detail) => ({
        field: detail.path,
        message: detail.message,
      })),
    };
  }

  if (error instanceof MongooseError.CastError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'ID буруу форматтай байна.',
      issues: [{ field: error.path, message: 'Утга буруу форматтай байна.' }],
    };
  }

  if (error instanceof mongo.MongoServerError && error.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? '_';
    const isEmail = field === 'email';
    return {
      statusCode: 409,
      code: isEmail ? ERROR_CODES.EMAIL_ALREADY_EXISTS : ERROR_CODES.DUPLICATE_KEY,
      message: isEmail ? ERROR_MESSAGES.EMAIL_ALREADY_EXISTS : ERROR_MESSAGES.DUPLICATE_KEY,
      issues: [{ field, message: 'Энэ утга аль хэдийн бүртгэгдсэн байна.' }],
    };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return {
      statusCode: 401,
      code: ERROR_CODES.TOKEN_INVALID,
      message: ERROR_MESSAGES.TOKEN_INVALID,
    };
  }

  return {
    statusCode: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: ERROR_MESSAGES.INTERNAL_ERROR,
  };
}

/**
 * Terminal error middleware. Guarantees the { success, data, message } envelope on
 * every failure path and never leaks a stack trace or driver message to the client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalised = normalise(error);

  const logPayload = {
    err: error,
    method: req.method,
    path: req.originalUrl,
    statusCode: normalised.statusCode,
    code: normalised.code,
    userId: req.auth?.userId ?? null,
  };

  if (normalised.statusCode >= 500) {
    logger.error(logPayload, 'Unhandled request error');
  } else {
    logger.warn(logPayload, 'Request rejected');
  }

  const body: ApiErrorResponse = {
    success: false,
    data: null,
    message: normalised.message,
    code: normalised.code,
    ...(normalised.issues ? { issues: normalised.issues } : {}),
  };

  // Development only: attach the original message to speed up debugging.
  if (!env.isProduction && normalised.statusCode >= 500 && error instanceof Error) {
    Object.assign(body, { debug: error.message });
  }

  res.status(normalised.statusCode).json(body);
}
