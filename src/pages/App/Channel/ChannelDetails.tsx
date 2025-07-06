import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "react-router-dom";
import { QueryParams } from "@shared/types/routes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function ChannelDetails() {
  const { workspaceId } = useParams<QueryParams>();
  const id = workspaceId as Id<"workspaces">;

  const channels = useQuery(api.channels.list, { workspaceId: id });

  return (
    <div className="container mx-auto p-4">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Channels in this workspace.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels ? (
            channels.length > 0 ? (
              channels.map((channel) => (
                <Card key={channel._id} className="flex flex-col">
                  <Link to={`./${channel._id}`} key={channel._id} className="flex-grow">
                    <CardHeader>
                      <CardTitle>{channel.name}</CardTitle>
                      <CardDescription>
                        {channel.roleCount.admin + channel.roleCount.member} members
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Click to view channel
                      </p>
                    </CardContent>
                  </Link>
                  <div className="p-4 pt-0">
                    <Link to={`./${channel._id}/settings`} className="w-full">
                      <Button variant="outline" className="w-full">
                        Settings
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No channels in this workspace.
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
