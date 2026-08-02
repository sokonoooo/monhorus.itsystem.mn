import type { ApiResponse } from '@monhorus/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, unwrap } from './api-client';

describe('unwrap', () => {
  it('returns the payload of a successful response', () => {
    const response = { data: { success: true, data: { id: 'x' }, message: 'Амжилттай.' } };
    expect(unwrap(response as { data: ApiResponse<{ id: string }> })).toEqual({ id: 'x' });
  });

  /**
   * The regression this exists for: a null payload on a successful response is the backend
   * saying "nothing here yet", not a failure. Treating it as an error made a floor with no
   * plan image report "Амжилттай." as its error message and replaced the whole screen with
   * the error state.
   */
  it('returns null when a successful response carries no payload', () => {
    const response = { data: { success: true, data: null, message: 'Амжилттай.' } };
    expect(unwrap(response as { data: ApiResponse<null> })).toBeNull();
  });

  it('throws when the envelope reports failure', () => {
    const response = { data: { success: false, data: null, message: 'Хүсэлт амжилтгүй.' } };

    expect(() => unwrap(response as { data: ApiResponse<null> })).toThrow(ApiError);
    expect(() => unwrap(response as { data: ApiResponse<null> })).toThrow('Хүсэлт амжилтгүй.');
  });

  it('passes an empty list through rather than treating it as missing', () => {
    const response = { data: { success: true, data: [], message: 'Амжилттай.' } };
    expect(unwrap(response as { data: ApiResponse<unknown[]> })).toEqual([]);
  });
});
