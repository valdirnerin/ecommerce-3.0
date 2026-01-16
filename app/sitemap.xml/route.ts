const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ecommerce-3-0.onrender.com'

const urls = [
  {
    loc: '',
    changefreq: 'daily',
    priority: '1.0',
  },
  {
    loc: 'faq',
    changefreq: 'weekly',
    priority: '0.6',
  },
]

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export async function GET() {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ loc, changefreq, priority }) => {
      const url = new URL(loc, BASE_URL).toString()
      return `  <url>\n    <loc>${url}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
    }),
    '</urlset>',
  ].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': `public, max-age=${revalidate}`,
    },
  })
}
