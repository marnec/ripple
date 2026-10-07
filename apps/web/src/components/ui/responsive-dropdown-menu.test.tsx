import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuGroup,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuLabel,
  ResponsiveDropdownMenuTrigger,
} from "./responsive-dropdown-menu";

/**
 * Base UI's `Menu.GroupLabel` throws outside a `Menu.Group`. The drawer
 * (phone) renders plain elements, so a label written straight into the
 * content only crashed on desktop — the task sheet's estimate menu did.
 */

beforeEach(() => {
  // Desktop: `useIsMobile` reads matchMedia, and jsdom ships none.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function menu(content: React.ReactNode) {
  render(
    <ResponsiveDropdownMenu open onOpenChange={() => {}}>
      <ResponsiveDropdownMenuTrigger>Open</ResponsiveDropdownMenuTrigger>
      <ResponsiveDropdownMenuContent>{content}</ResponsiveDropdownMenuContent>
    </ResponsiveDropdownMenu>,
  );
}

describe("ResponsiveDropdownMenuLabel on desktop", () => {
  it("renders as a plain heading outside a group instead of throwing", () => {
    menu(
      <>
        <ResponsiveDropdownMenuLabel>Estimate</ResponsiveDropdownMenuLabel>
        <ResponsiveDropdownMenuItem>1h</ResponsiveDropdownMenuItem>
      </>,
    );

    expect(screen.getByText("Estimate")).toBeInTheDocument();
  });

  it("still labels its group when inside one", () => {
    menu(
      <ResponsiveDropdownMenuGroup>
        <ResponsiveDropdownMenuLabel>Move to cycle</ResponsiveDropdownMenuLabel>
        <ResponsiveDropdownMenuItem>Cycle 4</ResponsiveDropdownMenuItem>
      </ResponsiveDropdownMenuGroup>,
    );

    const group = screen.getByRole("group");
    expect(group).toHaveAccessibleName("Move to cycle");
  });
});
