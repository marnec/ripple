import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAME } from "@shared/constants";
import React from "react";

export function DynamicBreadcrumb() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);

  let items = [];
  for (let i = 0; i < pathSegments.length; i++) {
    if (i % 2 !== 0) continue;

    const href = `/${pathSegments.slice(0, i + 2).join("/")}`;

    items.push({ href, label: `${pathSegments[i]}` });
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem key="#">
          <BreadcrumbLink onClick={() => navigate("/")}>
            {APP_NAME}
          </BreadcrumbLink>
        </BreadcrumbItem>
        {items.map(({ href, label }) => {
          return (
            <React.Fragment key={href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink onClick={() => navigate(href)}>
                  {label}
                </BreadcrumbLink>
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
