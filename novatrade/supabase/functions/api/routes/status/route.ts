import { integrationStatus } from "../../../_shared/server/config.ts";
import { route } from "../../../_shared/server/http.ts";

// Booleans only: which integrations are configured. Never any value.
export const GET = route(async () => ({ integrations: integrationStatus() }));
