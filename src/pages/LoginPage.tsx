import { SignInForm } from "@/pages/Authentication/SignInForm";
import { Authenticated } from "convex/react";
import { Navigate } from "react-router-dom";

export const LoginPage = () => {
  return (
    <>
      <Authenticated>
        <Navigate to="/" replace />
      </Authenticated>
      <div className="flex flex-row h-svh items-center justify-center">
        <SignInForm />
      </div>
    </>
  );
};
