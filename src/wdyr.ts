/// <reference types="@welldone-software/why-did-you-render" />
import React from "react";

if (import.meta.env.DEV) {
  const { default: whyDidYouRender } = await import(
    "@welldone-software/why-did-you-render"
  );
  whyDidYouRender(React, {
    trackAllPureComponents: true,
    trackHooks: true,
    logOnDifferentValues: false,
    logOwnerReasons: true,
    // Track all components matching these names (covers non-memo'd function components)
    include: [/AppSidebar/, /Layout/, /ChannelSelectorList/, /ProjectSelectorList/, /DocumentSelectorList/, /DiagramSelectorList/, /SpreadsheetSelectorList/, /Chat$/, /MessageComposer/, /Message$/, /DynamicBreadcrumb/, /WorkspaceSidebarProvider/, /WorkspaceMembersProvider/],
  });
}
