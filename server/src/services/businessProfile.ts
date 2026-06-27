import type { BusinessProfile } from "../types.js";
import { getBusinessProfile } from "../store.js";

export function formatShippingAddress(profile: BusinessProfile): string {
  const parts = [
    profile.shippingAddressLine1,
    profile.shippingAddressLine2,
    `${profile.city} ${profile.postalCode}`,
    profile.country,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Context block for Agent Brain and seller flows */
export function businessContextForAgents(profile: BusinessProfile = getBusinessProfile()): string {
  const shipTo = formatShippingAddress(profile);
  const lines = [
    `Business: ${profile.businessName} (UEN ${profile.uen})`,
    `Contact: ${profile.contactName} · ${profile.contactEmail} · ${profile.contactPhone}`,
    `Ship to: ${shipTo}`,
  ];
  return lines.join("\n");
}
