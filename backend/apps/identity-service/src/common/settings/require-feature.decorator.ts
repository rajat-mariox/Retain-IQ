import { SetMetadata } from "@nestjs/common";

export const FEATURE_FLAG_KEY = "requiredFeatureFlag";

/** Gate a controller/route behind a platform feature flag (enforced by FeatureFlagGuard). */
export const RequireFeature = (flag: string) => SetMetadata(FEATURE_FLAG_KEY, flag);
