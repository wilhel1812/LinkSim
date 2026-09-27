export const turnstileAction = 'github-login';
export const isRealTurnstileKey = value => typeof value === 'string' && /^0x[A-Za-z0-9_-]{20,}$/.test(value);
