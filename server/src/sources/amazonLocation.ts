/**
 * Amazon Location Service, Places API (spec 5.3 `geocode`).
 * Used when AMAZON_LOCATION_API_KEY is set; otherwise the tool falls back to
 * Open-Meteo geocoding so the project runs with no AWS account at all.
 */
import { GeocodeCommand, GeoPlacesClient } from "@aws-sdk/client-geo-places";
import { config } from "../config.js";
import { cacheKey, withCache } from "../lib/http.js";
import { SourceUnavailableError } from "../lib/errors.js";
import type { GeocodedPlace } from "./openMeteo.js";

export const AMAZON_LOCATION_SOURCE = "Amazon Location Service";
export const AMAZON_LOCATION_URL = "https://aws.amazon.com/location/";

let client: GeoPlacesClient | undefined;

export const isAmazonLocationConfigured = (): boolean => config.amazonLocationApiKey !== undefined;

function getClient(): GeoPlacesClient {
  client ??= new GeoPlacesClient({ region: config.awsRegion });
  return client;
}

export async function geocodeWithAmazonLocation(query: string): Promise<GeocodedPlace | undefined> {
  const key = config.amazonLocationApiKey;
  if (!key) {
    throw new SourceUnavailableError(AMAZON_LOCATION_SOURCE, "geocoding is not configured", {
      retryable: false,
    });
  }
  return withCache(
    cacheKey("amazon-location-geocode", { query: query.toLowerCase() }),
    async () => {
      try {
        const response = await getClient().send(
          new GeocodeCommand({
            QueryText: query,
            MaxResults: 1,
            // An API key authorises the call, so no IAM credentials are needed.
            Key: key,
            IntendedUse: "SingleUse",
          }),
        );
        const item = response.ResultItems?.[0];
        const position = item?.Position;
        const lon = position?.[0];
        const lat = position?.[1];
        if (!item || lat === undefined || lon === undefined) return undefined;
        const region = item.Address?.Region?.Name;
        const place: GeocodedPlace = {
          name: item.Address?.Label ?? item.Title ?? query,
          lat,
          lon,
          country: item.Address?.Country?.Name ?? "",
          countryCode: (item.Address?.Country?.Code2 ?? "").toUpperCase(),
        };
        return region ? { ...place, admin1: region } : place;
      } catch (error) {
        throw new SourceUnavailableError(AMAZON_LOCATION_SOURCE, "geocoding is unavailable", {
          cause: error,
        });
      }
    },
  );
}
