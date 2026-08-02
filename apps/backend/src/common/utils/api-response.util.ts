import type { ApiResponse } from '@monhorus/shared';
import type { Response } from 'express';

export function ok<T>(res: Response, data: T, message = 'Амжилттай.'): Response<ApiResponse<T>> {
  return res.status(200).json({ success: true, data, message });
}

export function created<T>(
  res: Response,
  data: T,
  message = 'Амжилттай үүслээ.',
): Response<ApiResponse<T>> {
  return res.status(201).json({ success: true, data, message });
}

export function noContent(res: Response, message = 'Амжилттай.'): Response<ApiResponse<null>> {
  return res.status(200).json({ success: true, data: null, message });
}
