/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Basic CSP for all pages (allows embedding only by KampusKita & localhost)
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'self' https://www.kampuskita.my.id https://bot.kampuskita.my.id https://bot.jualbeliusupolmed.web.id http://localhost:3000 http://localhost:3001;",
          },
        ],
      },
      {
        // Restrict frame-ancestors only to admin page where embedding is needed for OAuth flow
        source: '/admin/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://www.kampuskita.my.id https://bot.kampuskita.my.id https://bot.jualbeliusupolmed.web.id http://localhost:3000 http://localhost:3001;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;