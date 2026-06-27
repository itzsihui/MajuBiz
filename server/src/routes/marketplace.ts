import { Router } from "express";
import { quoteSellerListing, searchSellerAgentCatalogByQuery } from "../services/sellerAgentSearch.js";

export const marketplaceRouter = Router();

/** Agent-ready marketplace search — spawns a seller agent for the query */
marketplaceRouter.get("/marketplace/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.status(400).json({ error: "q query param required" });
    return;
  }

  const quantity = typeof req.query.quantity === "string" ? parseFloat(req.query.quantity) : undefined;
  const threshold = typeof req.query.threshold === "string" ? parseFloat(req.query.threshold) : undefined;
  const unit = typeof req.query.unit === "string" ? req.query.unit : undefined;

  const { seller, listings } = searchSellerAgentCatalogByQuery(q, 15, {
    quantity: Number.isFinite(quantity) ? quantity : undefined,
    unit,
    threshold: Number.isFinite(threshold) ? threshold : undefined,
  });

  res.json({
    query: q,
    source: "seller-agent",
    seller: {
      id: seller.id,
      name: seller.name,
      uen: seller.uen,
      tagline: seller.tagline,
    },
    count: listings.length,
    listings: listings.map((l) => ({
      id: l.id,
      sellerId: l.sellerId,
      sellerName: l.sellerName,
      title: l.title,
      description: l.description,
      listingPriceSgd: l.listingPriceSgd,
      packQuantity: l.packQuantity,
      unit: l.unit,
      currency: l.currency,
      url: l.url,
      inStock: l.inStock,
    })),
  });
});

/** Spawn or describe seller agent for a product category */
marketplaceRouter.get("/marketplace/sellers", (req, res) => {
  const product = typeof req.query.product === "string" ? req.query.product.trim() : "supplies";
  const { seller } = searchSellerAgentCatalogByQuery(product, 1);

  res.json({
    spawned: true,
    sellers: [
      {
        id: seller.id,
        name: seller.name,
        uen: seller.uen,
        tagline: seller.tagline,
        listingCount: seller.listings.length,
      },
    ],
  });
});

/** Get a priced quote for an agent purchase — machine-readable checkout input */
marketplaceRouter.post("/marketplace/quote", (req, res) => {
  const listingId = typeof req.body?.listingId === "string" ? req.body.listingId : "";
  const quantity = typeof req.body?.quantity === "number" ? req.body.quantity : 1;
  const unit = typeof req.body?.unit === "string" ? req.body.unit : "unit";

  if (!listingId) {
    res.status(400).json({ error: "listingId required" });
    return;
  }

  const quote = quoteSellerListing(listingId, quantity, unit);
  if (!quote) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  res.json({ source: "seller-agent", quote });
});
