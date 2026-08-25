import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@ripple/ui/components/tooltip";
import { ChannelCallIndicator } from "./ChannelCallIndicator";

const participant = (userId: string, userName: string) => ({
  userId,
  userName,
  userImage: null,
});

const renderIndicator = (
  participants: ReturnType<typeof participant>[],
) =>
  render(
    <TooltipProvider>
      <ChannelCallIndicator participants={participants} />
    </TooltipProvider>,
  );

afterEach(cleanup);

describe("ChannelCallIndicator", () => {
  it("renders nothing when no call is live", () => {
    const { container } = renderIndicator([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows no count for a lone participant", () => {
    renderIndicator([participant("u1", "Alice")]);

    expect(
      screen.getByLabelText("Call in progress — 1 participant"),
    ).toBeTruthy();
    expect(screen.queryByText("1")).toBeNull();
  });

  it("counts participants once there is more than one", () => {
    renderIndicator([
      participant("u1", "Alice"),
      participant("u2", "Bob"),
      participant("u3", "Carol"),
    ]);

    expect(
      screen.getByLabelText("Call in progress — 3 participants"),
    ).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});
