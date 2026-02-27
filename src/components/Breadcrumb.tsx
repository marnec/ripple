import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAME } from "@shared/constants";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

const getResourceNameRef = makeFunctionReference<"query", { resourceId: string }, string | null>("breadcrumb:getResourceName");
import React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronLeft } from "lucide-react";

interface BreadcrumbItemData {
  href: string;
  label: string;
  resourceId?: string;
}

interface BreadcrumbLinkWithResourceProps {
  item: BreadcrumbItemData;
  onClick: (href: string) => void;
}

function NamedBreadcrumbItem({ item, onClick }: BreadcrumbLinkWithResourceProps) {
  const resourceName = useQuery(
    getResourceNameRef,
    item.resourceId ? { resourceId: item.resourceId } : "skip"
  );

  const handleClick = () => {
    onClick(item.href);
  };

  let displayName;
  if (item.resourceId) {
    if (resourceName === undefined) {
      displayName = "...";
    } else {
      displayName = resourceName ?? item.label;
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

function MobileCurrentTitle({ item }: { item: BreadcrumbItemData }) {
  const resourceName = useQuery(
    getResourceNameRef,
    item.resourceId ? { resourceId: item.resourceId } : "skip"
  );

  let displayName;
  if (item.resourceId) {
    if (resourceName === undefined) {
      displayName = "...";
    } else {
      displayName = resourceName ?? item.label;
    }
  } else {
    displayName = item.label;
  }

  return (
    <span className="text-sm font-medium truncate">{displayName}</span>
  );
}

function MobileBreadcrumb({
  items,
  navigate,
}: {
  items: BreadcrumbItemData[];
  navigate: (path: string) => void;
}) {
  const currentItem = items.length > 0 ? items[items.length - 1] : null;
  const backHref = items.length > 1 ? items[items.length - 2].href : "/";

  return (
    <div className="flex items-center gap-1 min-w-0">
      <button
        onClick={() => navigate(backHref)}
        className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Go back"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="min-w-0 overflow-hidden">
        {currentItem ? (
          <MobileCurrentTitle item={currentItem} />
        ) : (
          <span className="text-sm font-medium truncate">{APP_NAME}</span>
        )}
      </div>
    </div>
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
        label: segment.charAt(0).toUpperCase() + segment.slice(1),
        resourceId: undefined,
      });
    }
  }

  if (isMobile) {
    return (
      <MobileBreadcrumb
        items={items}
        navigate={(path) => void navigate(path)}
      />
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem key="#">
          <BreadcrumbLink onClick={() => void navigate("/")} className="cursor-pointer">
            {APP_NAME}
          </BreadcrumbLink>
        </BreadcrumbItem>
        {items.map((item) => {
          return (
            <React.Fragment key={item.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <NamedBreadcrumbItem
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
