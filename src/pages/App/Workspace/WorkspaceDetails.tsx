import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "react-router-dom";
import { QueryParams } from "@shared/types/routes";
import { getUserDisplayName } from "@shared/displayName";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton"

export function WorkspaceDetails() {
  const { workspaceId } = useParams<QueryParams>();
  const id = workspaceId as Id<"workspaces">;

  const workspace = useQuery(api.workspaces.get, { id });
  const members = useQuery(api.workspaceMembers.membersByWorkspace, {
    workspaceId: id,
  });
  const documents = useQuery(api.documents.list, { workspaceId: id });
  const diagrams = useQuery(api.diagrams.list, { workspaceId: id });

  return (
    <div className="container mx-auto p-4">
      {workspace ? (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">
              Workspace {workspace.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {workspace.description || "No description available."}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>
                  Users in this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {members ? (
                  members.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {members.map((member) => (
                        <li key={member?._id} className="text-sm">
                          {getUserDisplayName(member)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No members in this workspace.
                    </p>
                  )
                ) : (
                  <Skeleton className="h-20" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
                <CardDescription>
                  Documents in this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {documents ? (
                  documents.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {documents.map((doc) => (
                        <li key={doc._id} className="text-sm">
                          {doc.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No documents in this workspace.
                    </p>
                  )
                ) : (
                  <Skeleton className="h-20" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Diagrams</CardTitle>
                <CardDescription>
                  Diagrams in this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {diagrams ? (
                  diagrams.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {diagrams.map((diag) => (
                        <li key={diag._id} className="text-sm">
                          {diag.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No diagrams in this workspace.
                    </p>
                  )
                ) : (
                  <Skeleton className="h-20" />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
      )}
    </div>
  );
}
