// Single source for the product name and the "Inspired by" credit. Everything reads brand.json
// (repo root) through here, so renaming the product is one change. Empty `inspiredBy` to remove
// the credit everywhere.
import brandJson from "../../../brand.json";

export interface InspiredBy {
  name: string;
  company: string;
  logoUrl: string;
  website: string;
  notAffiliated: string;
}

export interface Brand {
  name: string;
  displayName: string;
  productTitle: string;
  byline: string;
  appId: string;
  exeName: string;
  slug: string;
  repo: string;
  vaultFolderName: string;
  protocol: string;
  inspiredBy?: InspiredBy | null;
}

export const BRAND: Brand = brandJson as Brand;
export const INSPIRED_BY: InspiredBy | null = BRAND.inspiredBy?.name ? BRAND.inspiredBy : null;
