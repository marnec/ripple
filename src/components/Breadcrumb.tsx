import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import React, { memo, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface BreadcrumbItemData {
  href: string;
  label: string;
  resourceId?: string;
  category?: string;
}

/**
 * Each resource breadcrumb subscribes to its own name query,
 * so parent items (e.g. workspace) don't re-render when a sibling name changes.
 */
const ResourceBreadcrumbLink = memo(function ResourceBreadcrumbLink({
  item,
  onClick,
}: {
  item: BreadcrumbItemData;
  onClick: (href: string) => void;
}) {
  const name = useQuery(
    api.breadcrumb.getResourceName,
    item.resourceId ? { resourceId: item.resourceId as any } : "skip",
  );

  let displayName: string;
  if (item.resourceId) {
    displayName = name === undefined ? "..." : (name ?? item.label);
  } else {
    displayName = item.label;
  }

  return (
    <BreadcrumbLink
      onClick={() => onClick(item.href)}
      className="cursor-pointer"
    >
      {displayName}
    </BreadcrumbLink>
  );
});

function MobileCurrentTitle({ item }: { item: BreadcrumbItemData }) {
  const name = useQuery(
    api.breadcrumb.getResourceName,
    item.resourceId ? { resourceId: item.resourceId as any } : "skip",
  );

  let displayName: string;
  if (item.resourceId) {
    displayName = name === undefined ? "..." : (name ?? item.label);
  } else {
    displayName = item.label;
  }

  return (
    <span className="text-sm font-medium truncate">{displayName}</span>
  );
}

export function DynamicBreadcrumb() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const items = useMemo(() => {
    const pathSegments = location.pathname.split("/").filter(Boolean);
    const built: BreadcrumbItemData[] = [];
    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i];
      const href = `/${pathSegments.slice(0, i + 1).join("/")}`;
      const isResource = i % 2 !== 0;

      if (isResource) {
        built.push({ href, label: segment, resourceId: segment });
      } else {
        built.push({
          href,
          label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " "),
          category: segment,
        });
      }
    }
    return built;
  }, [location.pathname]);

  if (isMobile) {
    const currentItem = items.length > 0 ? items[items.length - 1] : null;
    if (!currentItem) return null;
    return <MobileCurrentTitle item={currentItem} />;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const delay = `${index * 50}ms`;
          return (
            <React.Fragment key={item.href}>
              {index > 0 && (
                <BreadcrumbSeparator
                  className="animate-in fade-in duration-200 fill-mode-both"
                  style={{ animationDelay: delay }}
                />
              )}
              <BreadcrumbItem
                className="animate-in fade-in duration-200 fill-mode-both"
                style={{ animationDelay: delay }}
              >
                <ResourceBreadcrumbLink
                  item={item}
                  onClick={(href) => void navigate(href)}
                />
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
