import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <section className="shell not-found" aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">This page is not here.</h1>
      <p>Consta only lives at the root. Go back and start an investigation.</p>
      <div className="not-found-actions">
        <Link className="btn btn--lime" href="/">
          Home
        </Link>
      </div>
    </section>
  );
}
