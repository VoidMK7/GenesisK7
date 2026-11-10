import { CONNECTORS } from "../../../_shared/core/connectors/registry.ts";
import { route } from "../../../_shared/server/http.ts";

// The catalogue, with honest support levels. Nothing here implies a broker is connected.
export const GET = route(async () => ({ connectors: CONNECTORS.map(({ create: _c, ...c }) => c) }));
