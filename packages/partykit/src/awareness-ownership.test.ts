import { describe, expect, it } from "vitest";
import { AwarenessOwnership } from "./awareness-ownership";

const changes = (over: Partial<{ added: number[]; updated: number[]; removed: number[] }>) => ({
  added: [],
  updated: [],
  removed: [],
  ...over,
});

describe("AwarenessOwnership", () => {
  it("attributes a client id to the connection that reported it", () => {
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));

    expect(ownership.release("connA")).toEqual([101]);
  });

  it("keeps a client id alive across further updates from its connection", () => {
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));
    ownership.record("connA", changes({ updated: [101] }));

    expect(ownership.ghosts([101], ["connA"])).toEqual([]);
  });

  it("treats a client id whose connection is gone as a ghost", () => {
    // The tab closed: its cursor is still in the awareness map, but nothing
    // is connected that could still be driving it.
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));
    ownership.record("connB", changes({ added: [202] }));

    expect(ownership.ghosts([101, 202], ["connB"])).toEqual([101]);
  });

  it("treats a client id nobody ever claimed as a ghost", () => {
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));

    expect(ownership.ghosts([101, 999], ["connA"])).toEqual([999]);
  });

  it("stops attributing a client id the connection retracted", () => {
    // A tab that did manage to announce its departure before the socket died.
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));
    ownership.record("connA", changes({ removed: [101] }));

    expect(ownership.release("connA")).toEqual([]);
    expect(ownership.ghosts([101], ["connA"])).toEqual([101]);
  });

  it("releases every client id a connection owned, once", () => {
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101, 102] }));

    expect(ownership.release("connA")).toEqual([101, 102]);
    expect(ownership.release("connA")).toEqual([]);
  });

  it("returns nothing for a connection it never saw", () => {
    const ownership = new AwarenessOwnership();
    expect(ownership.release("unknown")).toEqual([]);
  });

  it("forgets connections that are no longer live", () => {
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));

    ownership.ghosts([101], []); // connA is gone
    // Its ids must not linger and shadow a later reuse of the same client id.
    expect(ownership.release("connA")).toEqual([]);
  });

  it("reports nothing when the awareness map is empty", () => {
    const ownership = new AwarenessOwnership();
    ownership.record("connA", changes({ added: [101] }));

    expect(ownership.ghosts([], ["connA"])).toEqual([]);
  });
});
