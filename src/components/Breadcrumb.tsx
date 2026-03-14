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
import React, { useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface BreadcrumbItemData {
  href: string;
  label: string;
  resourceId?: string;
  category?: string;
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

  // Collect all resource IDs and batch-fetch their names in a single query
  const resourceIds = useMemo(
    () => items.filter((item) => item.resourceId).map((item) => item.resourceId!),
    [items],
  );
  const namesMap = useQuery(
    api.breadcrumb.getResourceNames,
    resourceIds.length > 0 ? { resourceIds: resourceIds as any } : "skip",
  );

  if (isMobile) {
    const currentItem = items.length > 0 ? items[items.length - 1] : null;
    if (!currentItem) return null;
    const displayName = currentItem.resourceId
      ? (namesMap === undefined ? "..." : (namesMap?.[currentItem.resourceId] ?? currentItem.label))
      : currentItem.label;
    return <span className="text-sm font-medium truncate">{displayName}</span>;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const delay = `${index * 50}ms`;
          let displayName: string;
          if (item.resourceId) {
            displayName = namesMap === undefined ? "..." : (namesMap?.[item.resourceId] ?? item.label);
          } else {
            displayName = item.label;
          }

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
                <BreadcrumbLink
                  onClick={() => void navigate(item.href)}
                  className="cursor-pointer"
                >
                  {displayName}
                </BreadcrumbLink>
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
