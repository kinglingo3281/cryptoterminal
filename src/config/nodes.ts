// Default node configurations
export const NODE_CONFIGS = {
  // Private node (highest priority)
  PRIVATE: {
    url: process.env.NEXT_PUBLIC_PRIVATE_NODE_URL || 'http://localhost:3001',
    isPrivate: true,
    priority: 1,
  },
  // Public Hyperliquid node (fallback)
  PUBLIC: {
    url: 'https://api.hyperliquid.xyz',
    isPrivate: false,
    priority: 2,
  },
} as const;

// Get all nodes as an array
export const getNodes = () => {
  return Object.values(NODE_CONFIGS);
};

// Get active nodes based on environment
export const getActiveNodes = () => {
  const nodes: Array<typeof NODE_CONFIGS.PRIVATE | typeof NODE_CONFIGS.PUBLIC> = [NODE_CONFIGS.PUBLIC]; // Always include public node
  
  // Only include private node if URL is provided
  if (process.env.NEXT_PUBLIC_PRIVATE_NODE_URL) {
    nodes.unshift(NODE_CONFIGS.PRIVATE);
  }
  
  return nodes;
};
