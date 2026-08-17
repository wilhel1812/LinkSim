const SENSITIVE_PROXY_RESPONSE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "www-authenticate",
  "proxy-authenticate",
  "cf-access-authenticated-user-email",
  "cf-access-authenticated-user-id",
  "cf-access-authenticated-user-name",
  "cf-access-jwt-assertion",
  "cf-access-client-id",
  "cf-access-client-secret",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
] as const;

export const stripSensitiveProxyResponseHeaders = (headers: Headers): Headers => {
  for (const name of SENSITIVE_PROXY_RESPONSE_HEADERS) headers.delete(name);
  return headers;
};
