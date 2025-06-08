import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import { HTMLAttributes } from "react";

interface SafeHtmlProps extends HTMLAttributes<HTMLDivElement> {
  html: string;
  className?: string;
}

export function SafeHtml({ html, className, ...props }: SafeHtmlProps) {
  return (
    <div
      className={cn(className)}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      {...props}
    />
  );
} 