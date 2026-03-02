"use client"

import { Search } from "lucide-react"

export function TrackerSection() {
    return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-card text-muted-foreground">
            <Search className="h-16 w-16 mb-4 opacity-30" />
            <h2 className="text-xl font-bold text-foreground mb-2">Symbol Tracker</h2>
            <p className="text-sm">Track and monitor specific symbols here</p>
        </div>
    )
}
