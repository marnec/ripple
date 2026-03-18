import { UserContext } from "@/pages/App/UserContext";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UserProfilePage() {
  const user = useContext(UserContext);
  const updateUser = useMutation(api.users.update);
  const navigate = useNavigate();

  const userName = user?.name || "";
  const [name, setName] = useState(userName);
  const [prevUserName, setPrevUserName] = useState(userName);
  if (userName !== prevUserName) {
    setPrevUserName(userName);
    setName(userName);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?._id) {
      void navigate("/");
      return;
    }

    try {
      await updateUser({ userId: user._id, name });
      toast.success("Profile updated", {
        description: "Your profile information has been updated successfully.",
      });
    } catch (error) {
      toast.error("Error updating profile", {
        description: error instanceof Error ? error.message : "Please try again later.",
      });
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-8">
      <div className="w-full max-w-100">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account information
          </p>
        </div>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-col gap-5 rounded-lg border bg-card p-6"
        >
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
              required
            />
          </div>
          <Button type="submit" className="h-11">
            Update profile
          </Button>
        </form>
      </div>
    </div>
  );
}
