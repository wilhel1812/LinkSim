import { createLiveWorker } from './live.mjs';
import { page, script } from './.wrangler/browser-module.mjs';

// No testUtils or synthetic login path in this entrypoint.
export default createLiveWorker({ page, script });
