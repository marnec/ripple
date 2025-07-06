import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Link, useParams } from "react-router-dom";
import { QueryParams } from "@shared/types/routes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Button } from "@/components/ui/button";

export function Documents() {
  const { workspaceId } = useParams<QueryParams>();
  const id = workspaceId as Id<"workspaces">;

  const documents = useQuery(api.documents.listByUserMembership, { workspaceId: id });

  return (
    <div className="container mx-auto p-4">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Documents in this workspace.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {documents ? (
            documents.length > 0 ? (
              documents.map((document) => (
                <Card key={document._id} className="flex flex-col">
                  <Link to={`./${document._id}`} key={document._id} className="flex-grow">
                    <CardHeader>
                      <CardTitle>{document.name}</CardTitle>
                      <CardDescription>
                        {(document.roleCount.admin || 0) + (document.roleCount.member || 0)} members
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Click to view document
                      </p>
                    </CardContent>
                  </Link>
                  <div className="p-4 pt-0">
                    <Link to={`./${document._id}/settings`} className="w-full">
                      <Button variant="outline" className="w-full">
                        Settings
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No documents in this workspace.
              </p>
            )
          ) : (
            <>
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}