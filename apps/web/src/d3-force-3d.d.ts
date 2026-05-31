// d3-force-3d ships no types and there is no @types/d3-force-3d. We pull the
// positioning forces from this package (rather than a redundant d3-force)
// because react-force-graph-2d / force-graph already runs its simulation on
// d3-force-3d — so these forces are guaranteed compatible with that engine.
// Only the surface we use (forceX/forceY) is declared; the returned force is
// structurally compatible with react-force-graph's loose ForceFn.
declare module "d3-force-3d" {
  type Accessor = number | ((node: unknown, i: number, nodes: unknown[]) => number);

  interface PositioningForce {
    (alpha: number): void;
    initialize?: (nodes: unknown[], ...args: unknown[]) => void;
    strength(strength: Accessor): PositioningForce;
    [key: string]: unknown;
  }

  export function forceX(x?: Accessor): PositioningForce;
  export function forceY(y?: Accessor): PositioningForce;
}
