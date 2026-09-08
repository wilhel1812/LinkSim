import { createProbe } from '../../../probe.mjs';

// Bundle-only Pages entrypoint. No deploy configuration or production bindings.
export const onRequest = ({ request, env }) => createProbe(env).handler(request);
