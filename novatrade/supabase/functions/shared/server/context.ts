import { AsyncLocalStorage } from "node:async_hooks";

/** The request being handled, so helpers like requireUser() need no argument. */
export const requestContext = new AsyncLocalStorage<{ req: Request }>();
export function currentRequest(): Request | null { return requestContext.getStore()?.req ?? null; }
