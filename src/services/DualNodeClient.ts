import { InfoClient, HttpTransport, WebSocketTransport, ExchangeClient, SubscriptionClient } from '@nktkas/hyperliquid';
import { ethers } from 'ethers';

type NodeHealth = {
  healthy: boolean;
  latency: number;
  lastChecked: number;
  error?: string;
};

type NodeConfig = {
  url: string;
  isPrivate: boolean;
  priority: number;
};

type NodeStatus = {
  config: NodeConfig;
  health: NodeHealth;
  client: InfoClient;
  transport: HttpTransport;
};

export class DualNodeClient {
  private nodes: NodeStatus[] = [];
  private activeNode: NodeStatus | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private failureThreshold = 2;
  private consecutiveFailures = 0;
  private isInitialized = false;
  private statusListeners: Array<(isUsingFallback: boolean) => void> = [];
  private exchangeClient: ExchangeClient | null = null;
  private subscriptionClient: SubscriptionClient | null = null;
  private wsTransport: WebSocketTransport | null = null;

  // Singleton instance
  private static instance: DualNodeClient;

  private constructor() {}

  public static getInstance(): DualNodeClient {
    if (!DualNodeClient.instance) {
      DualNodeClient.instance = new DualNodeClient();
    }
    return DualNodeClient.instance;
  }

  public async initialize(nodes: Array<{ url: string; isPrivate: boolean }>) {
    if (this.isInitialized) return;

    // Create node configurations with priorities (lower number = higher priority)
    this.nodes = nodes.map((node, index) => ({
      config: {
        ...node,
        priority: node.isPrivate ? 1 : 2,
      },
      health: {
        healthy: false,
        latency: 0,
        lastChecked: 0,
      },
      client: new InfoClient({
        transport: new HttpTransport({ apiUrl: node.url }),
      }),
      transport: new HttpTransport({ apiUrl: node.url }),
    }));

    // Sort nodes by priority (private first, then public)
    this.nodes.sort((a, b) => a.config.priority - b.config.priority);

    // Start with the highest priority node
    this.activeNode = this.nodes[0] || null;
    this.isInitialized = true;

    // Start health checks
    this.startHealthChecks();

    // Initial health check
    await this.checkNodeHealth();
  }

  private async checkNodeHealth() {
    if (!this.activeNode) return;

    const startTime = Date.now();
    try {
      await this.activeNode.client.meta();
      const latency = Date.now() - startTime;
      
      this.activeNode.health = {
        healthy: true,
        latency,
        lastChecked: Date.now(),
      };

      // If we were in fallback mode and the node is now healthy, consider switching back
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.consecutiveFailures = 0;
        this.notifyStatusChange(false);
      }
    } catch (error) {
      this.activeNode.health = {
        healthy: false,
        latency: 0,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.consecutiveFailures++;
      
      // If we've hit the failure threshold, try to switch to the next available node
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.switchToNextAvailableNode();
        this.notifyStatusChange(true);
      }
    }
  }

  private switchToNextAvailableNode() {
    if (!this.activeNode) return;

    const currentIndex = this.nodes.findIndex(
      (node) => node.config.url === this.activeNode?.config.url
    );

    // Try to find the next healthy node
    for (let i = 0; i < this.nodes.length; i++) {
      const nextIndex = (currentIndex + 1 + i) % this.nodes.length;
      const nextNode = this.nodes[nextIndex];
      
      if (nextNode.health.healthy) {
        console.log(`[DualNode] Switching from ${this.activeNode.config.url} to ${nextNode.config.url}`);
        this.activeNode = nextNode;
        this.consecutiveFailures = 0;
        this.notifyStatusChange(false);
        return;
      }
    }

    console.error('[DualNode] No healthy nodes available!');
  }

  private startHealthChecks() {
    // Check node health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.checkNodeHealth();
    }, 30000);
  }

  private notifyStatusChange(isUsingFallback: boolean) {
    this.statusListeners.forEach((listener) => listener(isUsingFallback));
  }

  public onStatusChange(listener: (isUsingFallback: boolean) => void) {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  public getActiveNode() {
    return this.activeNode;
  }

  public async getInfoClient(): Promise<InfoClient> {
    if (!this.activeNode) {
      throw new Error('No active node available');
    }
    return this.activeNode.client;
  }

  public async getExchangeClient(privateKey: string): Promise<ExchangeClient> {
    if (!this.activeNode) {
      throw new Error('No active node available');
    }

    if (!this.exchangeClient) {
      const wallet = new ethers.Wallet(privateKey);
      this.exchangeClient = new ExchangeClient({
        wallet,
        transport: this.activeNode.transport,
      });
    }

    return this.exchangeClient;
  }

  public async getSubscriptionClient(): Promise<SubscriptionClient> {
    if (!this.activeNode) {
      throw new Error('No active node available');
    }

    if (!this.subscriptionClient) {
      this.wsTransport = new WebSocketTransport({ 
        url: this.activeNode.config.url.replace('http', 'ws') 
      });
      this.subscriptionClient = new SubscriptionClient({ 
        transport: this.wsTransport 
      });
    }

    return this.subscriptionClient;
  }

  public cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.wsTransport) {
      this.wsTransport.close();
      this.wsTransport = null;
    }
    
    this.subscriptionClient = null;
    this.exchangeClient = null;
    this.isInitialized = false;
  }
}
