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
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import React from "react";

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
    api.breadcrumb.getResourceName,
    item.resourceId ? { resourceId: item.resourceId as Id<"workspaces"> | Id<"channels"> | Id<"documents"> } : "skip"
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

export function DynamicBreadcrumb() {
  const navigate = useNavigate();
  const location = useLocation();
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
