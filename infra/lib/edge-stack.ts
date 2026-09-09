import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import type * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { type Construct } from "constructs";

import { type ApiStack } from "./api-stack.ts";

export type EdgeStackProps = StackProps & {
  api: ApiStack;
  /** The SimulatorStack bucket by its fixed name; a construct reference would cycle through the OAC bucket policy. */
  assetsBucketName: string;
  /** `sla/origin-verify` (CoreStack): CloudFront presents it to the function URL, the Lambda checks it. */
  originVerifySecret: secretsmanager.ISecret;
  /** Phase 0 certificate in us-east-1 (Owner-issued; stored in cdk.context.json). */
  certificateArn: string;
  hostedZoneId: string;
  zoneName: string;
  domainName: string;
};

/**
 * Headers the MCP and OAuth surfaces need end to end. `Authorization` cannot be listed in
 * an origin request policy; CloudFront forwards it unchanged on POST, PUT, PATCH and
 * DELETE, and the viewer-request function below also carries it as
 * `X-Forwarded-Authorization` so a GET with a bearer survives too (the Lambda entry maps
 * it back: packages/app/src/forwarded-auth.ts). `CloudFront-Viewer-Address` is the real
 * client address for the OAuth rate limiter. CloudFront allow-lists exact names, not a
 * prefix, so every `Mcp-*` header the server reads is listed.
 */
export const FORWARDED_AUTHORIZATION_HEADER = "x-forwarded-authorization";
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";
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
  "CloudFront-Viewer-Address",
];

/** CloudFront Function (viewer request, API): the carrier header is always ours, never the viewer's. */
export const COPY_AUTHORIZATION_FUNCTION = `function handler(event) {
  var headers = event.request.headers;
  if (headers.authorization) {
    headers["${FORWARDED_AUTHORIZATION_HEADER}"] = { value: headers.authorization.value };
  } else {
    delete headers["${FORWARDED_AUTHORIZATION_HEADER}"];
  }
  return event.request;
}`;

/**
 * CloudFront Function (viewer response, API): Lambda function URLs rename a few response
 * headers, `WWW-Authenticate` among them, to `x-amzn-remapped-*`. MCP clients discover the
 * authorization server from the RFC 9728 challenge in `WWW-Authenticate`, so the original
 * name is restored at the edge (first deploy finding, D24).
 */
export const RESTORE_WWW_AUTHENTICATE_FUNCTION = `function handler(event) {
  var headers = event.response.headers;
  var remapped = headers["x-amzn-remapped-www-authenticate"];
  if (remapped) {
    headers["www-authenticate"] = { value: remapped.value };
    delete headers["x-amzn-remapped-www-authenticate"];
  }
  return event.response;
}`;

/** CloudFront Function (viewer request, SPA): deep links resolve to the app; `/demo` redirects to `/demo/`. */
export const SPA_ROUTING_FUNCTION = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === "/demo") {
    return { statusCode: 301, statusDescription: "Moved Permanently", headers: { location: { value: "/demo/" } } };
  }
  if (uri === "/demo/" || (uri.indexOf("/demo/") === 0 && uri.split("/").pop().indexOf(".") === -1)) {
    request.uri = "/demo/index.html";
  }
  return request;
}`;

/**
 * `alexa.spokenletter.com`: CloudFront in front of the streaming function URL (default
 * behaviour, no caching, MCP headers forwarded, a shared secret header the Lambda checks)
 * and the S3 assets (`/demo/*`, `/fixtures/*`, `/polly/*`), HSTS and nosniff, a WAF rate
 * rule on `/oauth/`, the single assets bucket policy, and the Route53 aliases.
 *
 * Not an origin access control on the function URL: with OAC, CloudFront signs the origin
 * request and Lambda rejects any POST that lacks `x-amz-content-sha256`, which no MCP or
 * OAuth client sends (D18).
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
      comment: "Carry the viewer bearer as X-Forwarded-Authorization",
      code: cloudfront.FunctionCode.fromInline(COPY_AUTHORIZATION_FUNCTION),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const restoreWwwAuthenticate = new cloudfront.Function(this, "RestoreWwwAuthenticate", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Restore WWW-Authenticate renamed by the function URL",
      code: cloudfront.FunctionCode.fromInline(RESTORE_WWW_AUTHENTICATE_FUNCTION),
    });
    const spaRouting = new cloudfront.Function(this, "SpaRouting", {
      functionName: "sla-alexa-spa-routing",
      comment: "Deep links to /demo/index.html; /demo redirects to /demo/",
      code: cloudfront.FunctionCode.fromInline(SPA_ROUTING_FUNCTION),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // Public function URL (AuthType NONE) guarded by a secret header only CloudFront knows.
    const apiOrigin = new origins.FunctionUrlOrigin(props.api.url, {
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
      customHeaders: { [ORIGIN_VERIFY_HEADER]: props.originVerifySecret.secretValue.unsafeUnwrap() },
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
    const spaBehavior: cloudfront.AddBehaviorOptions = {
      ...assetBehavior,
      functionAssociations: [{ function: spaRouting, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
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
        functionAssociations: [
          { function: copyAuthorization, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          { function: restoreWwwAuthenticate, eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE },
        ],
      },
      additionalBehaviors: {
        "/demo": { origin: assetsOrigin, ...spaBehavior },
        "/demo/*": { origin: assetsOrigin, ...spaBehavior },
        "/fixtures/*": { origin: assetsOrigin, ...assetBehavior },
        "/polly/*": { origin: assetsOrigin, ...assetBehavior, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED },
      },
      // No custom error responses: an API 403 or a missing object must stay what it is.
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
