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
import { RESOURCE_CATEGORY_ICONS } from "@/lib/resource-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";

interface BreadcrumbItemData {
  href: string;
  label: string;
  resourceId?: string;
  category?: string; // the URL segment name for category items (e.g. "workspaces")
}

interface BreadcrumbLinkWithResourceProps {
  item: BreadcrumbItemData;
  onClick: (href: string) => void;
  nameMap: Record<string, string | null> | undefined;
}

function NamedBreadcrumbItem({
  item,
  onClick,
  nameMap,
}: BreadcrumbLinkWithResourceProps) {
  const handleClick = () => {
    onClick(item.href);
  };

  let displayName;
  if (item.resourceId) {
    if (nameMap === undefined) {
      displayName = "...";
    } else {
      displayName = nameMap[item.resourceId] ?? item.label;
    }
  } else {
    displayName = item.label;
  }

  return (
    <BreadcrumbLink onClick={handleClick} className="cursor-pointer">
      {displayName}
    </BreadcrumbLink>
  );
}

function CategoryBreadcrumbItem({
  item,
  onClick,
}: Omit<BreadcrumbLinkWithResourceProps, "nameMap">) {
  const Icon = item.category
    ? RESOURCE_CATEGORY_ICONS[item.category]
    : undefined;

  if (!Icon) {
    return (
      <BreadcrumbLink
        onClick={() => onClick(item.href)}
        className="cursor-pointer"
      >
        {item.label}
      </BreadcrumbLink>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <BreadcrumbLink
          onClick={() => onClick(item.href)}
          className="cursor-pointer inline-flex items-center"
        >
          <Icon className="h-4 w-4" />
        </BreadcrumbLink>
      </TooltipTrigger>
      <TooltipContent>{item.label}</TooltipContent>
    </Tooltip>
  );
}

function MobileCurrentTitle({ item, nameMap }: { item: BreadcrumbItemData; nameMap: Record<string, string | null> | undefined }) {
  let displayName;
  if (item.resourceId) {
    if (nameMap === undefined) {
      displayName = "...";
    } else {
      displayName = nameMap[item.resourceId] ?? item.label;
    }
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
  const pathSegments = location.pathname.split("/").filter(Boolean);

  const items: BreadcrumbItemData[] = [];
  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    const href = `/${pathSegments.slice(0, i + 1).join("/")}`;
    const isResource = i % 2 !== 0;

    if (isResource) {
      items.push({ href, label: segment, resourceId: segment });
    } else {
      items.push({
        href,
        label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " "),
        category: segment,
      });
    }
  }

  const resourceIds = useMemo(
    () => items.filter((item) => item.resourceId).map((item) => item.resourceId!),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname],
  );

  const nameMap = useQuery(
    api.breadcrumb.getResourceNames,
    resourceIds.length > 0 ? { resourceIds: resourceIds as any } : "skip",
  );

  if (isMobile) {
    const currentItem = items.length > 0 ? items[items.length - 1] : null;
    if (!currentItem) return null;
    return <MobileCurrentTitle item={currentItem} nameMap={nameMap} />;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isCategory = !item.resourceId;
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
                {isCategory ? (
                  <CategoryBreadcrumbItem
                    item={item}
                    onClick={(href) => void navigate(href)}
                  />
                ) : (
                  <NamedBreadcrumbItem
                    item={item}
                    onClick={(href) => void navigate(href)}
                    nameMap={nameMap}
                  />
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
