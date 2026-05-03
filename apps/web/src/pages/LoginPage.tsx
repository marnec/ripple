import { SignInForm } from "@/pages/Authentication/SignInForm";
import { AuthLayout } from "@/pages/Authentication/AuthLayout";
import { Authenticated } from "convex/react";
import { Navigate } from "react-router-dom";

export const LoginPage = () => {
  return (
    <>
      <Authenticated>
        <Navigate to="/" replace />
      </Authenticated>
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
};
