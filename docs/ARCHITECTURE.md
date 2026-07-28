# AutoTrade Trading Terminal Architecture

## Product responsibility

The browser-based terminal was independently architected and built by Kenneth Lingo. Other developers contributed to separate services across the wider AutoTrade platform.

## Main application layers

### 1. Identity and access

Privy handled authentication and wallet-aware identity. The terminal coordinated login state, connected accounts, protected application behavior, and access to trading and account-specific features.

### 2. Application data and persistence

Supabase supported persisted application data and user-linked state. Production credentials and restricted server-side functions are omitted from the public snapshot.

### 3. Real-time shared state

Zustand coordinated fast-changing market, account, portfolio, signal, workspace, and execution state across multiple panels. The central challenge was keeping interconnected views synchronized while external data and user actions changed asynchronously.

### 4. Market and analytical visualization

Several charting systems supported different visualization needs. The interface used resizable panels and high-density information design so users could arrange market views, analysis, positions, orders, and automation controls as a working terminal.

### 5. Exchange and wallet integration

The application integrated the Hyperliquid SDK with Ethers and Viem tooling. This involved account state, market metadata, precision, asynchronous exchange responses, order state, wallet-aware flows, and error handling around systems outside the application's control.

### 6. Execution and risk workflows

The terminal connected order construction, positions, open orders, structured analysis, risk controls, and automated execution. Proprietary production algorithms and sensitive implementation details are intentionally omitted.

### 7. Upstream analysis and distribution

The workstation consumed normalized structured records from AutoTrade pipelines through a central PostgreSQL and SSE platform. Historical results were retrieved through bounded pagination rather than repeatedly transmitted through the live stream.

## Resilience model

AutoTrade depended on exchanges, third-party market data, external network connections, wallet infrastructure, and emerging SDKs. The system therefore expected intermittent failures and included reconnect behavior, health monitoring, controlled retries, planned service renewal, alerts, and recovery paths.

Those mechanisms were intentional operational design, not evidence of a known terminal memory leak.

## Public versus private scope

| Area | Public snapshot | Private production work |
|---|---|---|
| UI architecture | selected source | complete current application and history |
| authentication | representative integration | production configuration and policies |
| exchange integration | selected client logic | private endpoints and complete execution behavior |
| account data | no real user data | protected production records |
| strategies | limited or omitted | proprietary logic and performance history |
| infrastructure | deployment examples | private environment and operational configuration |
| Git history | clean public export | original multi-year development history |
