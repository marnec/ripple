import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { cn } from "@/lib/utils";

interface UserPresence {
  userId: string;
  online: boolean;
  name?: string;
  image?: string;
  lastDisconnected?: number;
}

interface FacePileProps {
  users: UserPresence[];
  max?: number;
  className?: string;
}

const getInitials = (name: string) => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const formatLastSeen = (lastDisconnected: number) => {
  const now = Date.now();
  const diff = now - lastDisconnected;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
};

export function FacePile({ users, max = 5, className }: FacePileProps) {
  const visibleUsers = users.slice(0, max);
  const remainingCount = users.length - max;

  return (
    <div className={cn("flex -space-x-2", className)}>
      {visibleUsers.map((user, index) => (
        <div
          key={user.userId}
          className="relative group"
          style={{ zIndex: max - index }}
        >
          <Avatar
            className={cn(
              "h-8 w-8 border-2 border-white transition-transform group-hover:scale-110",
              user.online ? "ring-2 ring-green-500" : "ring-2 ring-gray-300"
            )}
          >
            {user.image ? (
              <AvatarImage src={user.image} alt={user.name || "User"} />
            ) : (
              <AvatarFallback className="text-xs font-medium">
                {user.name ? getInitials(user.name) : "U"}
              </AvatarFallback>
            )}
          </Avatar>
          
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            <div className="font-medium">{user.name || user.userId}</div>
            <div className="text-xs opacity-80">
              {user.online ? "Online now" : formatLastSeen(user.lastDisconnected || 0)}
            </div>
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-black"></div>
          </div>
        </div>
      ))}
      
      {remainingCount > 0 && (
        <div
          className="relative group"
          style={{ zIndex: 0 }}
        >
          <Avatar className="h-8 w-8 border-2 border-white">
            <AvatarFallback className="text-xs font-medium bg-gray-100 text-gray-600">
              +{remainingCount}
            </AvatarFallback>
          </Avatar>
          
          {/* Tooltip for remaining users */}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            <div className="font-medium">{remainingCount} more user{remainingCount > 1 ? 's' : ''}</div>
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-black"></div>
          </div>
        </div>
      )}
    </div>
  );
} 