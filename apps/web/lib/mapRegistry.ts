import type { VortexMapTuning } from "@locket/vortex-engine";
import { DEFAULT_VORTEX_TUNING } from "@locket/vortex-engine";

export type MapId = "vortex";

export type MapDefinition = {
  id: MapId;
  label: string;
  description: string;
  tuning: VortexMapTuning;
};

export const MAPS: Record<MapId, MapDefinition> = {
  vortex: {
    id: "vortex",
    label: "Vortex",
    description: "Spinning ring, spiral paths, and trap squares.",
    tuning: { ...DEFAULT_VORTEX_TUNING },
  },
};

export const MAP_LIST: MapId[] = ["vortex"];
