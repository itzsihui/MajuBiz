/** Agent-ready seller listing types — catalogues are generated dynamically per buyer agent */

export interface SellerListing {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  description: string;
  keywords: string[];
  listingPriceSgd: number;
  packQuantity: number;
  unit: string;
  currency: "SGD";
  url: string;
  imageUrl?: string;
  inStock: boolean;
}

export interface SellerAgent {
  id: string;
  name: string;
  uen: string;
  tagline: string;
  listings: SellerListing[];
}
