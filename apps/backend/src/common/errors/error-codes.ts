export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PRIVILEGES: 'INSUFFICIENT_PRIVILEGES',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  SELF_ACTION_FORBIDDEN: 'SELF_ACTION_FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_KEY: 'DUPLICATE_KEY',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Clients switch on `code`; `message` is safe to render directly to the user. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Оруулсан мэдээлэл шаардлага хангахгүй байна.',
  INVALID_CREDENTIALS: 'Имэйл эсвэл нууц үг буруу байна.',
  ACCOUNT_LOCKED: 'Олон удаа буруу оролдсон тул бүртгэл түр хаагдсан байна.',
  ACCOUNT_SUSPENDED: 'Таны бүртгэл түр хаагдсан байна. Админтай холбогдоно уу.',
  PASSWORD_CHANGE_REQUIRED: 'Үргэлжлүүлэхийн тулд нууц үгээ солино уу.',
  UNAUTHENTICATED: 'Нэвтрэх шаардлагатай.',
  TOKEN_EXPIRED: 'Нэвтрэх хугацаа дууссан байна.',
  TOKEN_INVALID: 'Нэвтрэх мэдээлэл хүчингүй байна.',
  REFRESH_TOKEN_INVALID: 'Сессийн мэдээлэл хүчингүй байна. Дахин нэвтэрнэ үү.',
  // Deliberately one message for expired, already-used and never-existed. Telling them
  // apart would let someone with a stolen link learn whether it had been used, and the
  // remedy is the same in every case: ask for a new link.
  RESET_TOKEN_INVALID:
    'Нууц үг сэргээх холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Дахин хүсэлт илгээнэ үү.',
  FORBIDDEN: 'Энэ үйлдлийг хийх эрх байхгүй байна.',
  INSUFFICIENT_PRIVILEGES: 'Танд энэ түвшний хэрэглэгчийг удирдах эрх байхгүй.',
  EMAIL_ALREADY_EXISTS: 'Энэ имэйлээр бүртгэл аль хэдийн үүссэн байна.',
  SELF_ACTION_FORBIDDEN: 'Өөрийн бүртгэл дээр энэ үйлдлийг хийх боломжгүй.',
  NOT_FOUND: 'Хүссэн мэдээлэл олдсонгүй.',
  DUPLICATE_KEY: 'Давхардсан утга байна.',
  RATE_LIMITED: 'Хэт олон хүсэлт илгээлээ. Түр хүлээнэ үү.',
  INTERNAL_ERROR: 'Системд алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.',
};
