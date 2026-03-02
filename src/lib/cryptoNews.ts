type NewsArticle = {
    title: string
    link: string
    description?: string
    pubDate?: string
    source?: string
    timeAgo?: string
}

type Rss2JsonItem = {
    title: string
    pubDate: string
    link: string
    guid: string
    author: string
    thumbnail: string
    description: string
    content: string
}

type Rss2JsonResponse = {
    status: string
    feed: { title: string }
    items: Rss2JsonItem[]
}

const RSS_FEEDS = [
    { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph' },
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
    { url: 'https://decrypt.co/feed', source: 'Decrypt' },
]

const RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json'

// Decode HTML entities in text
function decodeHtmlEntities(text: string): string {
    if (!text) return ''
    
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&#38;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&#60;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#62;/g, '>')
        .replace(/&#8211;/g, '–') // en dash
        .replace(/&#8212;/g, '—') // em dash
        .replace(/&#8216;/g, '\u2018') // left single quote
        .replace(/&#8217;/g, '\u2019') // right single quote
        .replace(/&#8218;/g, '\u201A') // single low quote
        .replace(/&#8220;/g, '\u201C') // left double quote
        .replace(/&#8221;/g, '\u201D') // right double quote
        .replace(/&#8222;/g, '\u201E') // double low quote
        .replace(/&#8230;/g, '…') // ellipsis
        .replace(/&nbsp;/g, ' ')
        .replace(/&#160;/g, ' ')
        // Decode remaining numeric entities
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
}

// Strip HTML tags from description
function stripHtml(html: string): string {
    if (!html) return ''
    return html.replace(/<[^>]*>/g, '').trim()
}

// Relative time string from a date
function timeAgo(dateStr: string): string {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    if (isNaN(then)) return ''
    const diffMs = now - then
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
}

export async function fetchCryptoNews(): Promise<NewsArticle[]> {
    const results = await Promise.allSettled(
        RSS_FEEDS.map(async (feed) => {
            const url = `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(feed.url)}`
            const res = await fetch(url)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data: Rss2JsonResponse = await res.json()
            if (data.status !== 'ok') throw new Error(`rss2json status: ${data.status}`)

            return data.items.map((item): NewsArticle => ({
                title: decodeHtmlEntities(item.title),
                link: item.link,
                description: decodeHtmlEntities(stripHtml(item.description)).slice(0, 200),
                pubDate: item.pubDate,
                source: feed.source,
                timeAgo: timeAgo(item.pubDate),
            }))
        })
    )

    // Collect all successful results
    const articles: NewsArticle[] = []
    for (const r of results) {
        if (r.status === 'fulfilled') articles.push(...r.value)
    }

    // Sort by pubDate descending (newest first)
    articles.sort((a, b) => {
        const da = a.pubDate ? new Date(a.pubDate).getTime() : 0
        const db = b.pubDate ? new Date(b.pubDate).getTime() : 0
        return db - da
    })

    return articles
}
