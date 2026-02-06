import { UserContext } from "@/pages/App/UserContext";
import { useToast } from "@/components/ui/use-toast";
import { useMutation } from "convex/react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";


export function UserProfilePage() {
  const user = useContext(UserContext);
  const updateUser = useMutation(api.users.update);
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [name, setName] = useState("");

  const userName = user?.name || "";
  useEffect(() => {
    setName(userName);
  }, [userName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?._id) {
        void navigate("/");
        return;
    }

    try {
      await updateUser({ userId: user._id, name });
      toast({
        title: "Profile updated",
        description: "Your profile information has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error updating profile",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-semibold mb-6">User Profile</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-md bg-card shadow-md rounded-lg p-6 space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-muted-foreground">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full border border-input rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>
        <button type="submit" className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition duration-200">
          Update Profile
        </button>
      </form>
    </div>
  );
}