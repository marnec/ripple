import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { LoadingSpinner } from "../../../components/ui/loading-spinner";
import { DocumentMembershipSelection } from "./DocumentMembershipSelection";
import { DocumentMembershipRole } from "./DocumentMembershipRole";

type DocumentMembershipProps = {
  workspaceId: Id<"workspaces">;
  documentId: Id<"documents">;
};

const DocumentMembership = ({ workspaceId, documentId }: DocumentMembershipProps) => {
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const documentMembers = useQuery(api.documentMembers.membersByDocument, { documentId });

  return (
    <>
      {workspaceMembers && documentMembers ? (
        <div className="flex flex-col space-y-3">
          <h2 className="h2 ">Document members</h2>
          <DocumentMembershipSelection
            documentMembers={documentMembers}
            workspaceMembers={workspaceMembers}
            documentId={documentId}
          />
          <DocumentMembershipRole documentMembers={documentMembers} />
        </div>
      ) : (
        <LoadingSpinner />
      )}
    </>
  );
};

export const DocumentSettings = () => {
  const { workspaceId, documentId } = useParams<QueryParams>();

  if (!workspaceId || !documentId) return <SomethingWentWrong />;

  return (
    <div className="container mt-5">
      <DocumentMembership workspaceId={workspaceId} documentId={documentId} />
    </div>
  );
}; 