"use client"

import { useState, useEffect } from "react"
import { Newspaper, RefreshCw, ExternalLink } from "lucide-react"
import { fetchCryptoNews } from "@/lib/cryptoNews"

type NewsArticle = {
    title: string
    link: string
    description?: string
    pubDate?: string
    source?: string
    timeAgo?: string
}

export function NewsSection() {
    const [articles, setArticles] = useState<NewsArticle[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
    
    const loadNews = async () => {
        try {
            setError(null)
            const news = await fetchCryptoNews()
            
            // Dedupe by URL (prevent duplicates)
            const seen = new Set<string>()
            const deduped = news.filter(article => {
                if (!article?.link || seen.has(article.link)) return false
                seen.add(article.link)
                return true
            })
            
            setArticles(deduped.slice(0, 25))
            setLastUpdate(new Date())
            setLoading(false)
        } catch (err) {
            console.error('[NewsSection] Failed to load news:', err)
            setError('Failed to load news. Click refresh to retry.')
            setLoading(false)
        }
    }
    
    // Initial load + polling every 90 seconds
    useEffect(() => {
        loadNews()
        const interval = setInterval(loadNews, 90_000)
        return () => clearInterval(interval)
    }, [])
    
    // Loading state
    if (loading && articles.length === 0) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-card">
                <Newspaper className="h-16 w-16 mb-4 opacity-30 animate-pulse" />
                <p className="text-sm text-muted-foreground">Loading crypto news...</p>
            </div>
        )
    }
    
    return (
        <div className="h-full w-full flex flex-col bg-card">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                    <Newspaper className="h-4 w-4 text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">
                        Breaking Crypto News
                    </h2>
                    {lastUpdate && (
                        <span className="text-xs text-muted-foreground">
                            Updated {lastUpdate.toLocaleTimeString()}
                        </span>
                    )}
                </div>
                <button
                    onClick={loadNews}
                    disabled={loading}
                    className="p-2 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors disabled:opacity-50"
                    title="Refresh news"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
            
            {/* Error State */}
            {error && (
                <div className="m-4 p-3 rounded-lg border border-red-900/50 bg-red-950/30">
                    <p className="text-xs text-red-200">{error}</p>
                </div>
            )}
            
            {/* News List */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                    {articles.map((article, idx) => (
                        <a
                            key={article.link ?? idx}
                            href={article.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 transition-colors group"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
                                        {article.title}
                                    </h3>
                                    {article.description && (
                                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                                            {article.description}
                                        </p>
                                    )}
                                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                        {article.source && (
                                            <span className="font-medium">{article.source}</span>
                                        )}
                                        {article.timeAgo && (
                                            <>
                                                <span>•</span>
                                                <span>{article.timeAgo}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                            </div>
                        </a>
                    ))}
                    
                    {articles.length === 0 && !loading && !error && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Newspaper className="h-12 w-12 mb-3 opacity-20" />
                            <p className="text-sm text-muted-foreground">No news articles available</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
