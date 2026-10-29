/**
 * Bounded Camoufox publication adapters for the remaining community targets.
 *
 * The shared adapter core owns browser, hash, authority, idempotency and
 * independent verification gates. This module only publishes explicit
 * platform descriptors and registry entries. No credentials or live sessions
 * are created here.
 */
import {
  createCamoufoxPublicationAdapter,
  verifyCamoufoxPublicationEvidence,
  CAMOUFOX_PUBLICATION_PLATFORM_DESCRIPTORS
} from "./threads-reddit-publication-adapters.mjs";

const platforms = Object.freeze(["facebook_group", "product_hunt", "indie_hackers"]);

export const FACEBOOK_GROUP_ADAPTER = createCamoufoxPublicationAdapter("facebook_group");
export const PRODUCT_HUNT_ADAPTER = createCamoufoxPublicationAdapter("product_hunt");
export const INDIE_HACKERS_ADAPTER = createCamoufoxPublicationAdapter("indie_hackers");

export const FACEBOOK_PRODUCTHUNT_INDEPENDENT_ADAPTERS = Object.freeze({
  facebook_group: FACEBOOK_GROUP_ADAPTER,
  product_hunt: PRODUCT_HUNT_ADAPTER,
  indie_hackers: INDIE_HACKERS_ADAPTER
});

export const FACEBOOK_PRODUCTHUNT_INDEPENDENT_PLATFORM_DESCRIPTORS = Object.freeze(
  Object.fromEntries(platforms.map((platform) => [platform, CAMOUFOX_PUBLICATION_PLATFORM_DESCRIPTORS[platform]]))
);

export function getFacebookProductHuntIndieHackersAdapter(platform) {
  return FACEBOOK_PRODUCTHUNT_INDEPENDENT_ADAPTERS[String(platform || "").toLowerCase()] || null;
}

export function createFacebookProductHuntIndieHackersAdapter(platform, options = {}) {
  const key = String(platform || "").toLowerCase();
  if (!getFacebookProductHuntIndieHackersAdapter(key)) throw Object.assign(new Error("platform publication adapter is not registered"), { code: "PLATFORM_UNSUPPORTED" });
  return createCamoufoxPublicationAdapter(key, options);
}

export {
  verifyCamoufoxPublicationEvidence,
  platforms as FACEBOOK_PRODUCTHUNT_INDEPENDENT_PLATFORMS
};
