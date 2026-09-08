import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { type Construct } from "constructs";

import { type ApiStack } from "./api-stack.ts";

export type EdgeStackProps = StackProps & {
  api: ApiStack;
  /** The SimulatorStack bucket by its fixed name; a construct reference would cycle through the OAC bucket policy. */
  assetsBucketName: string;
  /** Phase 0 certificate in us-east-1 (Owner-issued; stored in cdk.context.json). */
  certificateArn: string;
  hostedZoneId: string;
  zoneName: string;
  domainName: string;
};

/**
 * Headers the MCP and OAuth surfaces need end to end. `Authorization` cannot be in an
 * origin request policy and, with an origin access control on the function URL,
 * CloudFront overwrites it with its own SigV4 signature. So a viewer-request function
 * copies the viewer's bearer into `X-Forwarded-Authorization`, which the Lambda entry
 * maps back (packages/app/src/forwarded-auth.ts).
 */
export const FORWARDED_AUTHORIZATION_HEADER = "x-forwarded-authorization";
export const FORWARDED_HEADERS = [
  "Accept",
  "Content-Type",
  "MCP-Protocol-Version",
  "Mcp-Method",
  "Mcp-Name",
  "Mcp-Session-Id",
  "Last-Event-ID",
  "Origin",
  "X-Forwarded-Authorization",
];

/** CloudFront Function (viewer request): preserve the viewer's Authorization header. */
export const COPY_AUTHORIZATION_FUNCTION = `function handler(event) {
  var headers = event.request.headers;
  if (headers.authorization && !headers["${FORWARDED_AUTHORIZATION_HEADER}"]) {
    headers["${FORWARDED_AUTHORIZATION_HEADER}"] = { value: headers.authorization.value };
  }
  return event.request;
}`;

/**
 * `alexa.spokenletter.com`: CloudFront in front of the streaming function URL (default
 * behaviour, no caching, MCP headers forwarded) and the S3 assets (`/demo/*`,
 * `/fixtures/*`, `/polly/*`), HSTS and nosniff, a WAF rate rule on `/oauth/`, and the
 * Route53 aliases.
 */
export class EdgeStack extends Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const certificate = acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn);

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: "sla-alexa-edge",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "sla-alexa-edge", sampledRequestsEnabled: true },
      rules: [
        {
          name: "oauth-rate-limit",
          priority: 0,
          action: { block: {} },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "sla-oauth-rate-limit", sampledRequestsEnabled: true },
          statement: {
            rateBasedStatement: {
              limit: 300,
              evaluationWindowSec: 300,
              aggregateKeyType: "IP",
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  searchString: "/oauth/",
                  textTransformations: [{ priority: 0, type: "LOWERCASE" }],
                },
              },
            },
          },
        },
      ],
    });

    const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, "ApiOriginRequest", {
      originRequestPolicyName: "sla-alexa-api",
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(...FORWARDED_HEADERS),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: "sla-alexa-security",
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
    });

    const copyAuthorization = new cloudfront.Function(this, "CopyAuthorization", {
      functionName: "sla-alexa-copy-authorization",
      comment: "Preserve the viewer bearer next to the OAC SigV4 signature",
      code: cloudfront.FunctionCode.fromInline(COPY_AUTHORIZATION_FUNCTION),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const apiOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(props.api.url, {
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
    });
    // Imported by name: the OAC bucket policy is written below, in this stack, so
    // SimulatorStack never has to reference the distribution.
    const assets = s3.Bucket.fromBucketName(this, "Assets", props.assetsBucketName);
    const assetsOrigin = origins.S3BucketOrigin.withOriginAccessControl(assets);
    const assetBehavior: cloudfront.AddBehaviorOptions = {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy,
      compress: true,
    };

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Spoken Letter for Alexa+",
      domainNames: [props.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: webAcl.attrArn,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: apiOrigin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy,
        responseHeadersPolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: false, // SSE frames must pass through untouched
        functionAssociations: [{ function: copyAuthorization, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/demo/*": { origin: assetsOrigin, ...assetBehavior },
        "/fixtures/*": { origin: assetsOrigin, ...assetBehavior },
        "/polly/*": { origin: assetsOrigin, ...assetBehavior, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED },
      },
      // The SPA is a single page under /demo/; deep links and the OAuth callback resolve to it.
      errorResponses: [{ httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/demo/index.html", ttl: Duration.seconds(0) }],
    });

    // The one bucket policy for the assets bucket: CloudFront (this distribution) may read,
    // nothing may use plain HTTP. SimulatorStack deliberately defines no policy of its own.
    new s3.BucketPolicy(this, "AssetsPolicy", { bucket: assets }).document.addStatements(
      new iam.PolicyStatement({
        sid: "AllowCloudFrontOAC",
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [assets.arnForObjects("*")],
        conditions: { StringEquals: { "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}` } },
      }),
      new iam.PolicyStatement({
        sid: "DenyInsecureTransport",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:*"],
        resources: [assets.bucketArn, assets.arnForObjects("*")],
        conditions: { Bool: { "aws:SecureTransport": "false" } },
      }),
    );

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: props.hostedZoneId, zoneName: props.zoneName });
    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
    new route53.ARecord(this, "AliasA", { zone, recordName: props.domainName, target });
    new route53.AaaaRecord(this, "AliasAAAA", { zone, recordName: props.domainName, target });
  }
}
