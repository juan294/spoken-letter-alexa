import { existsSync } from "node:fs";
import path from "node:path";

import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { type Construct } from "constructs";

/**
 * Private bucket (OAC from CloudFront only) holding the built simulator under `demo/`,
 * the Owner's fixture recordings under `fixtures/audio/` and Polly replies under
 * `polly/` (expired after a day).
 */
/** Fixed so ApiStack can grant `polly/` writes without a cross-stack reference (which would cycle through EdgeStack). */
export const ASSETS_BUCKET_NAME = "sla-alexa-assets-106403001709";

export class SimulatorStack extends Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, "Assets", {
      bucketName: ASSETS_BUCKET_NAME,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // No bucket policy here (enforceSSL would add one): EdgeStack owns the single policy
      // with the CloudFront OAC grant and the secure-transport deny.
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ prefix: "polly/", expiration: Duration.days(1), enabled: true }],
    });

    const repoRoot = path.resolve(import.meta.dirname, "../..");
    const spaDist = path.join(repoRoot, "packages/simulator/dist");
    const fixtures = path.join(repoRoot, "fixtures");
    // `pnpm build` produces the SPA; a synth without a build still succeeds with a marker object.
    const spaSource = existsSync(spaDist)
      ? s3deploy.Source.asset(spaDist)
      : s3deploy.Source.data(".placeholder", "build the simulator with pnpm build before deploying");
    new s3deploy.BucketDeployment(this, "Spa", {
      destinationBucket: this.bucket,
      destinationKeyPrefix: "demo",
      sources: [spaSource],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString("public, max-age=300")],
    });
    // The Owner's recordings (fixtures/README.md); absent until exported.
    if (existsSync(path.join(fixtures, "audio"))) {
      new s3deploy.BucketDeployment(this, "Fixtures", {
        destinationBucket: this.bucket,
        destinationKeyPrefix: "fixtures",
        sources: [s3deploy.Source.asset(fixtures, { exclude: ["README.md", "stories.json"] })],
        prune: false,
        cacheControl: [s3deploy.CacheControl.fromString("public, max-age=86400")],
      });
    }
  }
}
