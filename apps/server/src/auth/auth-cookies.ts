import type { CookieOptions } from 'express';

export const REFRESH_COOKIE = 'twg_rt';
export const OAUTH_STATE_COOKIE = 'twg_oauth';

/** The refresh cookie is only ever sent to /v1/auth/*, never to the rest of the API. */
export function refreshCookieOptions(secure: boolean, expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/v1/auth',
    expires: expiresAt,
  };
}

export function oauthStateCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/v1/auth/google',
    maxAge: 10 * 60 * 1000,
  };
}
