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
    // Call with resource ID if defined, else use label
    const identifier = item.resourceId || item.label;
    console.log('Breadcrumb clicked with identifier:', identifier);
    onClick(item.href);
  };

  const displayName = resourceName ? `${resourceName} [${item.label}]` :  item.label;

  return (
    <BreadcrumbLink onClick={handleClick}>
      {displayName}
    </BreadcrumbLink>
  );
}

export function DynamicBreadcrumb() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);

  let items: BreadcrumbItemData[] = [];
  for (let i = 0; i < pathSegments.length; i++) {
    if (i % 2 !== 0) continue;

    const href = `/${pathSegments.slice(0, i + 2).join("/")}`;
    const label = pathSegments[i];
    const resourceId = i + 1 < pathSegments.length ? pathSegments[i + 1] : undefined;

    items.push({ href, label, resourceId });
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem key="#">
          <BreadcrumbLink onClick={() => navigate("/")}>
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
                  onClick={navigate}
                />
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
