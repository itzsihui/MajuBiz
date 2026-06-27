import { Router } from "express";
import type { BusinessProfile } from "../types.js";
import { getBusinessProfile, updateBusinessProfile } from "../store.js";

export const settingsRouter = Router();

const STRING_FIELDS: (keyof BusinessProfile)[] = [
  "businessName",
  "uen",
  "contactName",
  "contactEmail",
  "contactPhone",
  "shippingAddressLine1",
  "shippingAddressLine2",
  "postalCode",
  "city",
  "country",
];

settingsRouter.get("/settings/business", (_req, res) => {
  res.json({ profile: getBusinessProfile() });
});

settingsRouter.patch("/settings/business", (req, res) => {
  const patch: Partial<BusinessProfile> = {};

  for (const key of STRING_FIELDS) {
    const value = req.body?.[key];
    if (typeof value === "string") {
      patch[key] = value.trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Provide at least one business profile field to update" });
    return;
  }

  if (patch.businessName === "") {
    res.status(400).json({ error: "businessName cannot be empty" });
    return;
  }

  if (patch.shippingAddressLine1 === "") {
    res.status(400).json({ error: "shippingAddressLine1 cannot be empty" });
    return;
  }

  const profile = updateBusinessProfile(patch);
  res.json({ profile });
});
