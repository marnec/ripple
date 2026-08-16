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
        {/* Self-signup is closed: accounts come from invitations only, so the
            public login screen offers sign-in and points would-be users at the
            contact address. InviteAcceptPage still allows sign-up. */}
        <SignInForm allowSignUp={false} />
      </AuthLayout>
    </>
  );
};
