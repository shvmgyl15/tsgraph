import type { Graph } from "../graph/types.js";
import { analyzeComplexity, cyclomaticComplexity } from "./complexity.js";
import type { ComplexityResult } from "./complexity.js";
import { findHotspots } from "./hotspot.js";
import type { HotspotResult } from "./hotspot.js";
import { analyzeCoupling, dependencyTree } from "./coupling.js";
import type { CouplingResult, DepsNode } from "./coupling.js";

export {
  analyzeComplexity,
  cyclomaticComplexity,
  findHotspots,
  analyzeCoupling,
  dependencyTree,
};

export type { ComplexityResult, HotspotResult, CouplingResult, DepsNode };
