/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_PUBLIC_MODE === 'pi' ? 'standalone' : undefined,
  // Type errors must fail the build: a lib/types.ts <-> API mismatch should never reach the Pi silently.
  // Check locally with: pnpm exec tsc --noEmit
  images: {
    unoptimized: true,
  },
}

export default nextConfig
