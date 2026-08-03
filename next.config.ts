import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Emits `.next/standalone`: a self-contained server with only the
  // production dependencies actually used, traced file-by-file. The Docker
  // build below copies just that output, so the deployed image carries no
  // devDependencies, no full node_modules, and no source files that were not
  // reachable from a route — which is what keeps a Cloud Run cold start fast.
  output: "standalone",
};

export default nextConfig;
