import { createGateway } from './durable-gateway.mjs';
import { page, script } from './.wrangler/browser-module.mjs';
export default createGateway({ page, script });
