import type { Metadata } from "next";

import IdentityForm from "@/components/identity/IdentityForm";
import IdentityPanel from "@/components/identity/IdentityPanel";
import IdentityProvider from "@/components/identity/IdentityProvider";

export const metadata: Metadata = {
  title: { absolute: "Consta" },
  description: "Investigación de identidad.",
};

export default function HomePage() {
  return (
    <IdentityProvider>
      <div className="identity-screen">
        <IdentityForm />
        <IdentityPanel />
      </div>
    </IdentityProvider>
  );
}
